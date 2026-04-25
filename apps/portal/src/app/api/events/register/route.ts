import { NextResponse, after } from 'next/server';
import { flags } from '@/lib/flags';
import { registerRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { checkExistingRegistration } from '@/features/events/shared/duplicate-check';
import { checkSevakByEmail } from '@/features/events/shared/sevak-check';
import { findFamilyById, findFamilyByContact } from '@/features/check-in/shared';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';
import { checkIpRateLimit } from '@/features/events/shared/rate-limiter';

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

  let parsed: ReturnType<typeof registerRequestSchema.parse>;
  try {
    parsed = registerRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  parsed.email = parsed.email.toLowerCase().trim();

  try {
    let existing = null;
    if (parsed.category === 'bv-family') {
      if (parsed.fid) {
        existing = await checkExistingRegistration({ type: 'fid', value: parsed.fid });
      }
      if (!existing) {
        existing = await checkExistingRegistration({ type: 'bvFamilyEmail', value: parsed.email });
      }
    } else if (parsed.category === 'sevak' || parsed.category === 'non-bv') {
      existing = await checkExistingRegistration({
        type: 'email',
        value: parsed.email,
        category: parsed.category,
      });
    }
    if (existing) {
      return NextResponse.json(
        { error: 'Duplicate registration', existingRegistration: existing },
        { status: 409 },
      );
    }
  } catch (err) {
    console.error('Duplicate check failed, proceeding with registration:', err);
  }

  const maxMothersFromParents =
    (parsed.category === 'bv-family' || parsed.category === 'sevak') &&
    parsed.adults === 2
      ? 1
      : parsed.adults;
  const additional = parsed.additionalAttendees ?? 0;
  const maxMothers = maxMothersFromParents + additional;
  if ((parsed.mothersInPuja ?? 0) > maxMothers) {
    return NextResponse.json(
      { error: `Mothers count cannot exceed ${maxMothers} for this registration` },
      { status: 400 },
    );
  }

  try {
    if (parsed.category === 'sevak') {
      const isSevak = await checkSevakByEmail(parsed.email);
      if (!isSevak) {
        return NextResponse.json(
          { error: 'Email not found in BV Teacher/Sevak roster' },
          { status: 403 },
        );
      }
    } else if (parsed.category === 'bv-family') {
      const family = parsed.fid
        ? await findFamilyById(parsed.fid)
        : await findFamilyByContact('email', parsed.email);
      if (!family) {
        return NextResponse.json(
          { error: 'Not found in BV Family roster' },
          { status: 403 },
        );
      }
    }
  } catch (err) {
    console.error('Roster check failed, proceeding with registration:', err);
  }

  try {
    await registrationsCollection().doc(parsed.registrationId).create({
      ...parsed,
      paymentStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    const message = (err as Error).message || '';
    if (message.includes('ALREADY_EXISTS')) {
      return NextResponse.json(
        { error: 'Registration ID already exists' },
        { status: 409 },
      );
    }
    console.error('Firebase write failed:', message);
    const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    if (googleSheetUrl) {
      try {
        await fetch(googleSheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        });
        return NextResponse.json({ success: true, registrationId: parsed.registrationId });
      } catch {
        return NextResponse.json(
          { error: 'Registration failed. Please try again.' },
          { status: 503 },
        );
      }
    }
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 503 },
    );
  }

  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (googleSheetUrl) {
    after(async () => {
      await sendToGoogleSheet(googleSheetUrl, parsed);
    });
  }

  return NextResponse.json({ success: true, registrationId: parsed.registrationId });
}
