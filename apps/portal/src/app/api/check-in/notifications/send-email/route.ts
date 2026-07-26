import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';


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
  const { to, template, props } = parsed.data;

  // Only donation-thank-you migrates. This route also dispatches `otp-code`,
  // which must never reach the managed path: an SES-side template edit could
  // break every sign-in at once, with no deploy and no review. payment-reminder
  // arrives here too, but its real caller is payment-reminder-service.ts, which
  // is migrated at source - routing it again here would double the contract.
  if (template === 'donation-thank-you') {
    await sendManagedEmail({
      name: 'donation-thank-you',
      to,
      data: props,
      fallback: () => sendTemplatedEmail({ to, template, props }),
    });
  } else {
    await sendTemplatedEmail({ to, template, props });
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
