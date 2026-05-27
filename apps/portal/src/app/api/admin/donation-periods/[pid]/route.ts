import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import {
  UpdateDonationPeriodSchema,
  type DonationPeriodDoc,
} from '@cmt/shared-domain';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ pid: string }> },
) {
  const uid = req.headers.get('x-portal-uid');
  if (!uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const { pid } = await params;
  const db = portalFirestore();
  const periodRef = db.collection('donationPeriods').doc(pid);
  const snap = await periodRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = UpdateDonationPeriodSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const existing = snap.data() as DonationPeriodDoc;

  // Validate date ordering when only one side is provided
  const startDate = data.startDate ? new Date(data.startDate) : (existing.startDate as unknown as Date);
  const endDate = data.endDate ? new Date(data.endDate) : (existing.endDate as unknown as Date);
  if (endDate <= startDate) {
    return NextResponse.json(
      { error: 'bad-request', issues: [{ path: ['endDate'], message: 'endDate must be after startDate' }] },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: uid };
  if (data.periodLabel !== undefined) update.periodLabel = data.periodLabel;
  if (data.startDate !== undefined) update.startDate = Timestamp.fromDate(new Date(data.startDate));
  if (data.endDate !== undefined) update.endDate = Timestamp.fromDate(new Date(data.endDate));
  if (data.suggestedAmount !== undefined) update.suggestedAmount = data.suggestedAmount;
  if (data.amountTiers !== undefined) update.amountTiers = data.amountTiers;
  if (data.enabled !== undefined) update.enabled = data.enabled;

  await periodRef.update(update);
  return NextResponse.json({ pid });
}
