import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { updateReferenceRequestSchema } from '@cmt/shared-domain/events/api-contracts';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { registrationsCollection } from '@/features/events/shared/firestore-adapter';
import { sendToGoogleSheet } from '@/features/events/shared/google-sheets-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!flags.eventsRegister) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof updateReferenceRequestSchema.parse>;
  try {
    parsed = updateReferenceRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const doc = await registrationsCollection().doc(parsed.registrationId).get();
    if (!doc.exists || doc.data()?.email?.toLowerCase() !== parsed.email.toLowerCase()) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
  } catch (err) {
    console.error('Firebase lookup for update-reference failed:', (err as Error).message);
    return NextResponse.json({ error: 'Unable to verify registration' }, { status: 502 });
  }

  try {
    await registrationsCollection().doc(parsed.registrationId).set(
      {
        etransferReference: parsed.etransferReference,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Firebase update-reference failed:', (err as Error).message);
  }

  const googleSheetUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL;
  if (googleSheetUrl) {
    await sendToGoogleSheet(googleSheetUrl, {
      registrationId: parsed.registrationId,
      etransferReference: parsed.etransferReference,
      action: 'update_reference',
    });
  }

  return NextResponse.json({
    success: true,
    registrationId: parsed.registrationId,
  });
}
