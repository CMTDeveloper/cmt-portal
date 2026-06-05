import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkAndRecordOtpRateLimit, LOOKUP_RATE_LIMIT_MAX } from '@/features/check-in/shared';
import {
  lookupFamilyByContactList,
  type ContactInput,
} from '@/features/setu/registration/family-lookup';

// Accept BOTH the new array body and the legacy single email+phone body.
// Every field is optional at the schema layer; we require at least one usable
// contact below (a stricter 400 than zod can express across the two shapes).
const bodySchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  emails: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
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

  const { email, phone, emails, phones } = parsed.data;

  const contacts: ContactInput[] = [
    ...(emails ?? (email ? [email] : [])).map((value) => ({ type: 'email' as const, value })),
    ...(phones ?? (phone ? [phone] : [])).map((value) => ({ type: 'phone' as const, value })),
  ].filter((c) => c.value.trim() !== '');

  if (contacts.length === 0) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  // Rate-limit by IP — misses still consume quota (anti-enumeration).
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rate = await checkAndRecordOtpRateLimit(`family-lookup:${ip}`, LOOKUP_RATE_LIMIT_MAX);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const match = await lookupFamilyByContactList(contacts);

  return NextResponse.json({ match }, { status: 200 });
}
