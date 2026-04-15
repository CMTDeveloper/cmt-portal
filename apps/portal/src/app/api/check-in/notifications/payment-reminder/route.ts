import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  familyId: z.string().min(1),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const result = await sendPaymentReminder(parsed.data.familyId);
  return NextResponse.json(result, { status: 200 });
}
