import { NextResponse } from 'next/server';
import { GuestCheckInSchema } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { recordGuestCheckIn } from '@/features/check-in/shared';

// The schema moved to shared-domain on 2026-08-05, when the front desk gained
// its own way to record a visitor (POST /api/welcome/visitors). Two routes now
// create the SAME `guest_check_ins` document and are read by the same screens;
// two copies of the validation over one document is how a field ends up
// required on one path and optional on the other, with no way for a reader to
// tell which produced a given row.
const bodySchema = GuestCheckInSchema;

export async function POST(req: Request) {
  if (!flags.checkInKiosk) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const { notes, ...rest } = parsed.data;
  const input = {
    ...rest,
    ...(notes !== undefined ? { notes } : {}),
  };
  const id = await recordGuestCheckIn(input);
  return NextResponse.json({ success: true, id }, { status: 200 });
}
