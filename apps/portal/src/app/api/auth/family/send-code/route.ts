import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  checkAndRecordOtpRateLimit,
  findFamilyByContact,
  mockSender,
  normalizeContact,
  storeVerificationCode,
} from '@/features/check-in/shared';

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
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const normalized = normalizeContact(parsed.data.type, parsed.data.value);
  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const family = await findFamilyByContact(parsed.data.type, parsed.data.value);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const code = generateCode();
  await storeVerificationCode(normalized, code, parsed.data.type);

  if (parsed.data.type === 'email') {
    await mockSender.sendEmail({
      to: parsed.data.value,
      subject: 'Your CMT portal verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
  } else {
    await mockSender.sendSMS({
      phone: parsed.data.value,
      message: `CMT portal code: ${code} (10 min)`,
    });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
