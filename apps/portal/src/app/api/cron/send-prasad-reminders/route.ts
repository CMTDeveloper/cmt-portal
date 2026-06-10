import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendDuePrasadReminders } from '@/features/setu/prasad/reminder-service';

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

  // Opt-in kill switch, mirroring the weekly-payment-reminders cron. Stays off
  // until PRASAD_REMINDER_CRON_ENABLED is explicitly "true" in Vercel. Server-only
  // env (not NEXT_PUBLIC) so it can be flipped without a client-bundle redeploy.
  if (process.env.PRASAD_REMINDER_CRON_ENABLED !== 'true') {
    return NextResponse.json(
      { success: true, disabled: true, checked: 0, sent: 0, skipped: 0, failed: 0 },
      { status: 200 },
    );
  }

  const result = await sendDuePrasadReminders();
  return NextResponse.json({ success: true, ...result }, { status: 200 });
}
