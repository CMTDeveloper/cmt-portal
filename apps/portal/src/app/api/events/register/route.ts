import { NextResponse, after } from 'next/server';
import { flags } from '@/lib/flags';
import { registerRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
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
