import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { UpdateOfferingSchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ oid: string }> },
) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const { oid } = await params;
  const db = portalFirestore();
  const offeringRef = db.collection('offerings').doc(oid);
  const snap = await offeringRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = UpdateOfferingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const existing = snap.data() as Record<string, unknown>;

  function tsToDate(v: unknown): Date {
    if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
      return (v as { toDate: () => Date }).toDate();
    }
    return v instanceof Date ? v : new Date(v as string);
  }

  // Validate date ordering when only one side is provided and both sides are non-null
  const startDate = data.startDate != null ? new Date(data.startDate) : tsToDate(existing['startDate']);
  const newEndDate = data.endDate !== undefined ? data.endDate : existing['endDate'];
  if (newEndDate != null) {
    const endDate = typeof newEndDate === 'string' ? new Date(newEndDate) : tsToDate(newEndDate);
    if (endDate <= startDate) {
      return NextResponse.json(
        { error: 'bad-request', issues: [{ path: ['endDate'], message: 'endDate must be after startDate' }] },
        { status: 400 },
      );
    }
  }

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session.uid,
  };

  if (data.termLabel !== undefined) update['termLabel'] = data.termLabel;
  if (data.termType !== undefined) update['termType'] = data.termType;
  if (data.startDate !== undefined) update['startDate'] = Timestamp.fromDate(new Date(data.startDate));
  if (data.endDate !== undefined) {
    update['endDate'] = data.endDate != null ? Timestamp.fromDate(new Date(data.endDate)) : null;
  }
  if (data.pricingTiers !== undefined) update['pricingTiers'] = data.pricingTiers;
  if (data.amountTiers !== undefined) update['amountTiers'] = data.amountTiers;
  if (data.paymentSource !== undefined) update['paymentSource'] = data.paymentSource;
  if (data.enabled !== undefined) update['enabled'] = data.enabled;

  await offeringRef.update(update);

  revalidateTag('offerings', 'max');
  return NextResponse.json({ oid });
}
