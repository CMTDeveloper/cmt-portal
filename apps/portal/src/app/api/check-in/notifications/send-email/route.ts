import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  to: z.string().email(),
  template: z.enum(['otp-code', 'payment-reminder', 'donation-thank-you']),
  props: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  await sendTemplatedEmail({
    to: parsed.data.to,
    template: parsed.data.template,
    props: parsed.data.props,
  });
  return NextResponse.json({ success: true }, { status: 200 });
}
