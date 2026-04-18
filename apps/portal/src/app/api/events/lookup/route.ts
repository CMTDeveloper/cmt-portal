import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { lookupRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof lookupRequestSchema.parse>;
  try {
    parsed = lookupRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const doc = await registrationsCollection().doc(parsed.registrationId).get();

    if (doc.exists) {
      const data = doc.data()!;
      if (data.email?.toLowerCase() === parsed.email.toLowerCase()) {
        return NextResponse.json({
          registrationId: parsed.registrationId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          adults: data.adults,
          children: data.children,
          payment_source: data.payment_source,
          contribution: data.contribution,
          isBvFamily: data.isBvFamily || false,
          category: data.category || 'non-bv',
          additionalAttendees: data.additionalAttendees || 0,
          mothersInPuja: data.mothersInPuja || 0,
          fid: data.fid || '',
          paymentStatus: data.paymentStatus || 'pending',
          etransferReference: data.etransferReference || '',
          contributionExpected: data.contributionExpected || undefined,
          contributionReceived: data.contributionReceived || undefined,
        });
      }
    }
  } catch (err) {
    console.error('Firebase lookup failed, falling back to Google Sheet:', err);
  }

  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (!googleSheetUrl) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
  }

  try {
    const url = `${googleSheetUrl}?registrationId=${encodeURIComponent(parsed.registrationId)}&email=${encodeURIComponent(parsed.email)}`;
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    const data = await response.json();
    if (data.email && data.email.toLowerCase() !== parsed.email.toLowerCase()) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error('Lookup failed:', err);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 });
  }
}
