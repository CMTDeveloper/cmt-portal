import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { webhookPaymentStatusRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.WEBHOOK_API_KEY;
  if (!apiKey || !expectedKey || !safeEqual(apiKey, expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();

    let parsed: ReturnType<typeof webhookPaymentStatusRequestSchema.parse>;
    try {
      parsed = webhookPaymentStatusRequestSchema.parse(body);
    } catch {
      return NextResponse.json(
        { error: 'registrationId and paymentStatus are required' },
        { status: 400 },
      );
    }

    try {
      await registrationsCollection().doc(parsed.registrationId).set(
        {
          paymentStatus: parsed.paymentStatus,
          payment_source: parsed.payment_source,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.error('Firebase payment-status update failed:', (err as Error).message);
    }

    const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
    if (googleSheetUrl) {
      await sendToGoogleSheet(googleSheetUrl, {
        registrationId: parsed.registrationId,
        paymentStatus: parsed.paymentStatus,
        payment_source: parsed.payment_source,
        updatedAt: new Date().toISOString(),
      }).catch((err: Error) => console.error('Google Sheet webhook update failed:', err.message));
    }

    return NextResponse.json({
      success: true,
      registrationId: parsed.registrationId,
      paymentStatus: parsed.paymentStatus,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
