import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { checkBvStatusRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { findFamilyById, findFamilyByContact } from '@/features/check-in/shared';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';
import { checkSevakByEmail } from '@/features/events/shared/sevak-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    const { allowed } = await checkIpRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }
  } catch {
    // degraded mode — allow through
  }

  let parsed: ReturnType<typeof checkBvStatusRequestSchema.parse>;
  try {
    parsed = checkBvStatusRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    if ('sevakEmail' in parsed) {
      const isSevak = await checkSevakByEmail(parsed.sevakEmail);
      return NextResponse.json({ isSevak });
    }

    if ('email' in parsed) {
      const family = await findFamilyByContact('email', parsed.email);
      if (family) {
        const emails = family.contacts
          .filter((c) => c.type === 'email')
          .map((c) => c.value.toLowerCase().trim());
        const phones = family.contacts
          .filter((c) => c.type === 'phone')
          .map((c) => c.value);
        return NextResponse.json({ isBvFamily: true, familyEmails: emails, familyPhones: phones });
      }
      return NextResponse.json({ isBvFamily: false });
    }

    const family = await findFamilyById(parsed.familyId);
    if (family) {
      const emails = family.contacts
        .filter((c) => c.type === 'email')
        .map((c) => c.value.toLowerCase().trim());
      const phones = family.contacts
        .filter((c) => c.type === 'phone')
        .map((c) => c.value);
      return NextResponse.json({ isBvFamily: true, familyEmails: emails, familyPhones: phones });
    }
    return NextResponse.json({ isBvFamily: false });
  } catch (err) {
    console.error('BV status check failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ isBvFamily: false });
  }
}
