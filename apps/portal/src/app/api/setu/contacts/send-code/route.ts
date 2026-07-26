import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  checkAndRecordOtpRateLimit,
  CONTACTS_SEND_PER_SENDER_MAX,
  normalizeContact,
  storeVerificationCode,
} from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { isSetuFamily } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
});

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Authenticated as a family member (any role) via the middleware-set
  // x-portal-* headers (covers cookie AND Bearer/mobile sessions). The
  // catch-all denies non-managers, so canAccessRoute MUST open this path.
  const session = readSessionFromHeaders(req);
  if (!session || !isSetuFamily(session) || !session.mid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value } = parsed.data;

  // Adding a phone to a profile is verified BY SMS, so with SMS undeliverable
  // the whole add-a-phone path is dead - for every number, not just non-NANP
  // ones. Refusing is better than the alternative of storing an unverified
  // phone: contactKeys would then key sign-in on a number nobody proved they
  // own. The email add-path is untouched, and so is phone CAPTURE at
  // registration and member edit, which never verified by SMS.
  if (type === 'phone' && !flags.smsOtp) {
    return NextResponse.json({ error: 'sms-signin-unsupported' }, { status: 400 });
  }

  const normalized = normalizeContact(type, value);

  // OTP rate-limit keyed by the target contact (per-contact, like auth send-code).
  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  // Second bucket keyed by the SENDER (the caller, not the target), so an
  // authenticated member can't spray single OTPs to many arbitrary contacts.
  const senderRate = await checkAndRecordOtpRateLimit(
    `contacts-send:${session.mid}`,
    CONTACTS_SEND_PER_SENDER_MAX,
  );
  if (!senderRate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: senderRate.resetAt }, { status: 429 });
  }

  const code = generateCode();
  await storeVerificationCode(normalized, code, type);

  if (type === 'email') {
    const canonicalEmail = normalizeContactForKey('email', value);
    await resolveSender().sendEmail({
      to: canonicalEmail,
      subject: 'Confirm your contact for Chinmaya Setu',
      text: `Enter this code to add this email to your family profile: ${code} (expires in 10 minutes).`,
    });
  } else {
    await resolveSender().sendSMS({
      phone: normalizeContactForKey('phone', value),
      message: `Chinmaya Setu code to add this phone: ${code} (10 min)`,
    });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
