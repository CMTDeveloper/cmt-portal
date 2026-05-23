import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { lookupFamilyByContacts } from '@/features/setu/registration/family-lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { email, phone } = parsed.data;

  // Rate-limit by IP — misses still consume quota (anti-enumeration)
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rate = await checkAndRecordOtpRateLimit(`family-lookup:${ip}`);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const match = await lookupFamilyByContacts(email, phone);

  return NextResponse.json({ match }, { status: 200 });
}
