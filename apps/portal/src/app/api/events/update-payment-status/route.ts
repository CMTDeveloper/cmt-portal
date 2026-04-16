import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { updatePaymentStatusRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof updatePaymentStatusRequestSchema.parse>;
  try {
    parsed = updatePaymentStatusRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const doc = await registrationsCollection().doc(parsed.registrationId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
    const data = doc.data()!;
    if (data.payment_source !== 'stripe') {
      return NextResponse.json({ error: 'Not a Stripe payment' }, { status: 400 });
    }
  } catch (err) {
    console.error('Firebase lookup failed:', (err as Error).message);
    // Continue with update attempt even if verification fails
  }

  try {
    await registrationsCollection().doc(parsed.registrationId).set(
      {
        paymentStatus: 'completed',
        payment_source: 'stripe',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Firebase payment status update failed:', (err as Error).message);
  }

  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (googleSheetUrl) {
    sendToGoogleSheet(googleSheetUrl, {
      registrationId: parsed.registrationId,
      paymentStatus: 'completed',
      payment_source: 'stripe',
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    registrationId: parsed.registrationId,
  });
}
