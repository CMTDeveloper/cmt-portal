import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { verifyRegistrationRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { findFamilyById, findFamilyByContact } from '@/features/check-in/shared';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';
import { checkSevakByEmail } from '@/features/events/shared/sevak-check';
import { checkExistingRegistration } from '@/features/events/shared/duplicate-check';

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

  let parsed: ReturnType<typeof verifyRegistrationRequestSchema.parse>;
  try {
    parsed = verifyRegistrationRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    // Sevak path
    if ('sevakEmail' in parsed) {
      const sevakEmail = parsed.sevakEmail.toLowerCase().trim();
      const isSevak = await checkSevakByEmail(sevakEmail);
      let existingRegistration: { registrationId: string; paymentStatus: string } | undefined;
      if (isSevak) {
        const existing = await checkExistingRegistration({
          type: 'email',
          value: sevakEmail,
          category: 'sevak',
        });
        if (existing) existingRegistration = existing;
      }
      return NextResponse.json({ isSevak, existingRegistration });
    }

    // Non-BV duplicate check path
    if ('checkDuplicateEmail' in parsed) {
      const checkDuplicateEmail = parsed.checkDuplicateEmail.toLowerCase().trim();
      const existing = await checkExistingRegistration({
        type: 'email',
        value: checkDuplicateEmail,
        category: 'non-bv',
      });
      return NextResponse.json({ existingRegistration: existing ?? undefined });
    }

    // BV family paths (email or familyId)
    if ('email' in parsed) {
      const family = await findFamilyByContact('email', parsed.email);
      if (!family) return NextResponse.json({ isBvFamily: false });

      const emails = family.contacts
        .filter((c) => c.type === 'email')
        .map((c) => c.value.toLowerCase().trim());
      const phones = family.contacts
        .filter((c) => c.type === 'phone')
        .map((c) => c.value);

      let existingRegistration: { registrationId: string; paymentStatus: string } | undefined;
      const existing = await checkExistingRegistration({ type: 'fid', value: family.fid });
      if (existing) {
        existingRegistration = existing;
      } else {
        for (const email of emails) {
          const byEmail = await checkExistingRegistration({ type: 'bvFamilyEmail', value: email });
          if (byEmail) { existingRegistration = byEmail; break; }
        }
      }

      return NextResponse.json({
        isBvFamily: true,
        fid: family.fid,
        familyEmails: emails,
        familyPhones: phones,
        existingRegistration,
      });
    }

    // familyId path
    const family = await findFamilyById(parsed.familyId);
    if (!family) return NextResponse.json({ isBvFamily: false });

    const emails = family.contacts
      .filter((c) => c.type === 'email')
      .map((c) => c.value.toLowerCase().trim());
    const phones = family.contacts
      .filter((c) => c.type === 'phone')
      .map((c) => c.value);

    let existingRegistration: { registrationId: string; paymentStatus: string } | undefined;
    const existing = await checkExistingRegistration({ type: 'fid', value: family.fid });
    if (existing) {
      existingRegistration = existing;
    } else {
      for (const email of emails) {
        const byEmail = await checkExistingRegistration({ type: 'bvFamilyEmail', value: email });
        if (byEmail) { existingRegistration = byEmail; break; }
      }
    }

    return NextResponse.json({
      isBvFamily: true,
      fid: family.fid,
      familyEmails: emails,
      familyPhones: phones,
      existingRegistration,
    });
  } catch (err) {
    console.error(
      'Verification check failed:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ isBvFamily: false });
  }
}
