import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { getSessionFamily } from '@/features/setu/members/get-session-family';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { FamilyEmergencyContactSchema, FamilyAddressSchema } from '@cmt/shared-domain';
import { getLocationOptions } from '@/lib/locations';

// Header-based session (works for cookie AND Bearer/mobile callers) — the
// cookie-only getCurrentFamily() silently 401'd valid Bearer requests.
export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const result = await getSessionFamily(req);
  if (!result) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  return NextResponse.json(result, { status: 200 });
}

// Family-level edits (the optional emergency contact + the home address) are
// manager-only. canAccessRoute also gates PATCH on this path to isSetuManager,
// so this handler's isManager check is defence-in-depth. Both keys are optional
// (partial update); send emergencyContact `null` to clear it.
const patchSchema = z.object({
  familyEmergencyContact: FamilyEmergencyContactSchema.nullable().optional(),
  familyAddress: FamilyAddressSchema.optional(),
  // The CMT centre. Sent by /complete-profile when the family was migrated on a
  // guessed centre. Validated against the admin-managed options below, not just
  // by this schema - `location` drives level matching, teacher rosters and
  // roster filters, so an arbitrary string here would corrupt all three.
  location: z.string().min(1).optional(),
});

export async function PATCH(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const result = await getSessionFamily(req);
  if (!result) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!result.isManager) {
    return NextResponse.json({ error: 'not-manager' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // Only write keys the caller actually sent, so a familyAddress-only PATCH
  // never wipes familyEmergencyContact (and vice-versa).
  const update: Record<string, unknown> = {};
  if ('familyEmergencyContact' in parsed.data) update.familyEmergencyContact = parsed.data.familyEmergencyContact;
  if (parsed.data.familyAddress !== undefined) update.familyAddress = parsed.data.familyAddress;

  if (parsed.data.location !== undefined) {
    const allowed = await getLocationOptions();
    if (!allowed.includes(parsed.data.location)) {
      return NextResponse.json({ error: 'unknown-location' }, { status: 400 });
    }
    update.location = parsed.data.location;
    // The family has now stated their centre, so it is no longer a guess.
    // Written as an explicit `false` rather than deleted: it distinguishes
    // "asked and answered" from "never asked" (absent), which is what makes the
    // flag usable as a welcome-team follow-up queue. Only `true` gates anything.
    update.locationNeedsConfirmation = false;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  await portalFirestore().collection('families').doc(result.family.fid).set(update, { merge: true });

  revalidateTag(`family-${result.family.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
