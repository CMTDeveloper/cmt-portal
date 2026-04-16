import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';
import { listAllFamilies } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return false;
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Opt-in kill switch. Ashram staff currently handle payment reminders
  // manually, so this cron stays off until the env var is explicitly set to
  // "true" in Vercel. Keeping it a server-only env (not NEXT_PUBLIC) so it
  // can be flipped without a redeploy of the client bundle.
  if (process.env.WEEKLY_REMINDER_CRON_ENABLED !== 'true') {
    return NextResponse.json(
      { success: true, disabled: true, processed: 0, sent: 0, skipped: 0 },
      { status: 200 },
    );
  }

  const all = await listAllFamilies();
  const unpaid = all.filter((f) => f.paymentStatus !== 'paid');

  let sent = 0;
  let skipped = 0;
  for (const family of unpaid) {
    const result = await sendPaymentReminder(family.fid);
    if (result.sent) sent += 1;
    else skipped += 1;
  }

  return NextResponse.json(
    { success: true, processed: unpaid.length, sent, skipped },
    { status: 200 },
  );
}
