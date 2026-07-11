import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { getSessionFamily } from '@/features/setu/members/get-session-family';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { FamilyEmergencyContactSchema } from '@cmt/shared-domain';

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

// Family-level edits (currently the single optional emergency contact) are
// manager-only. canAccessRoute also gates PATCH on this path to isSetuManager,
// so this handler's isManager check is defence-in-depth. Send `null` to clear.
const patchSchema = z.object({
  familyEmergencyContact: FamilyEmergencyContactSchema.nullable(),
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

  await portalFirestore()
    .collection('families')
    .doc(result.family.fid)
    .set({ familyEmergencyContact: parsed.data.familyEmergencyContact }, { merge: true });

  revalidateTag(`family-${result.family.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
