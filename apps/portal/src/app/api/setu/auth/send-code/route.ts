import { createHash, randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  checkAndRecordOtpRateLimit,
  normalizeContact,
  storeVerificationCode,
} from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value } = parsed.data;
  const normalized = normalizeContact(type, value);
  const hashPrefix = createHash('sha256').update(normalized).digest('hex').slice(0, 8);

  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    console.log(`[send-code] hash=${hashPrefix} type=${type} → rate-limited`);
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  // Look up Setu family first; fall back to legacy roster.
  // Always return 200 regardless — no contact enumeration.
  const result = await findSetuFamilyByContact(type, value);
  console.log(
    `[send-code] hash=${hashPrefix} type=${type} source=${result.source ?? 'null'} fid=${result.fid ?? result.legacyFid ?? '-'}`,
  );

  if (result.source === null) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const code = generateCode();
  await storeVerificationCode(normalized, code, type);

  if (type === 'email') {
    await resolveSender().sendEmail({
      to: value,
      subject: 'Your CMT portal verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
  } else {
    await resolveSender().sendSMS({
      phone: value,
      message: `CMT portal code: ${code} (10 min)`,
    });
  }

  console.log(`[send-code] hash=${hashPrefix} → sent (source=${result.source})`);
  return NextResponse.json({ success: true }, { status: 200 });
}
