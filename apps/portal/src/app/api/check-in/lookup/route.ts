import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { findFamilyByContact } from '@/features/check-in/shared';
import { resolveKioskFamily } from '@/features/setu/check-in/resolve-kiosk-family';


const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
});

export async function POST(req: Request) {
  if (!flags.checkInKiosk) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const family = await findFamilyByContact(parsed.data.type, parsed.data.value);
  if (!family) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Surface the family's NEW Family ID (publicFid) so the "Forgot your ID?"
  // result can lead with it and mark the legacy id as retiring - the same nudge
  // the check-in kiosk shows. The legacy contact match gives us the legacy id;
  // the Setu family (looked up by that legacy id) carries the publicFid, which
  // is minted at first enrollment. A family not in Setu, or not yet enrolled,
  // has no publicFid → the result shows just the legacy id, as before. A Setu
  // read failure must not fail the lookup, so it degrades to legacy-only.
  const setu = await resolveKioskFamily(family.fid).catch(() => null);
  const publicFid = setu?.publicFid ?? null;

  return NextResponse.json({ familyId: family.fid, publicFid }, { status: 200 });
}
