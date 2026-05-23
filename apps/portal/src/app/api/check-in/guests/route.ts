import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordGuestCheckIn } from '@/features/check-in/shared';

export const runtime = 'nodejs';

const bodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  numberOfAdults: z.coerce.number().int().min(0),
  numberOfChildren: z.coerce.number().int().min(0),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const { email, phone, notes, ...required } = parsed.data;
  const input = {
    ...required,
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
  const id = await recordGuestCheckIn(input);
  return NextResponse.json({ success: true, id }, { status: 200 });
}
