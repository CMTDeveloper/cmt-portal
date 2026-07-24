import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { recordGuestCheckIn } from '@/features/check-in/shared';


// One guest child: name + grade (a CHILD_GRADE_OPTIONS value) so a teacher can
// match them to a class. Both required once a child row is added.
const guestChildSchema = z.object({
  name: z.string().min(1),
  grade: z.string().min(1),
});

const bodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Email + phone are REQUIRED so a checked-in guest family is reachable and can
  // later claim their account (Vaibhav). phone.min(7) mirrors registration.
  email: z.string().email(),
  phone: z.string().min(7),
  numberOfAdults: z.coerce.number().int().min(0),
  // Per-child name + grade (may be empty for an adults-only visit). The store
  // derives numberOfChildren from this.
  children: z.array(guestChildSchema).default([]),
  notes: z.string().optional(),
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
  const { notes, ...rest } = parsed.data;
  const input = {
    ...rest,
    ...(notes !== undefined ? { notes } : {}),
  };
  const id = await recordGuestCheckIn(input);
  return NextResponse.json({ success: true, id }, { status: 200 });
}
