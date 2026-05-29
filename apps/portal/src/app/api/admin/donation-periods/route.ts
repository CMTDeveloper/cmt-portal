import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import {
  CreateDonationPeriodSchema,
  type DonationPeriodDoc,
  isAdmin,
  toSafeSlug,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';

const PROGRAM_LABELS: Record<string, string> = {
  'bala-vihar': 'Bala Vihar',
};

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const db = portalFirestore();
  const snap = await db.collection('donationPeriods').orderBy('startDate', 'desc').get();
  const periods = snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      startDate: (data.startDate as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      endDate: (data.endDate as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      createdAt: (data.createdAt as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      updatedAt: (data.updatedAt as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
    };
  });
  return NextResponse.json({ periods });
}

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = CreateDonationPeriodSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const db = portalFirestore();
  const now = FieldValue.serverTimestamp();

  // Check for overlap with existing enabled periods for the same (programKey, location)
  const overlapSnap = await db
    .collection('donationPeriods')
    .where('programKey', '==', data.programKey)
    .where('location', '==', data.location)
    .where('enabled', '==', true)
    .get();

  const newStart = new Date(data.startDate);
  const newEnd = new Date(data.endDate);
  const overlaps = overlapSnap.docs.some((d) => {
    const existing = d.data() as DonationPeriodDoc;
    const existStart = (existing.startDate as unknown as ReturnType<typeof Timestamp.now>).toDate();
    const existEnd = (existing.endDate as unknown as ReturnType<typeof Timestamp.now>).toDate();
    return newStart <= existEnd && newEnd >= existStart;
  });

  const periodSlug = toSafeSlug(data.periodLabel);
  if (!periodSlug) {
    return NextResponse.json(
      {
        error: 'invalid-period-label',
        message: 'Period label must contain alphanumeric characters',
      },
      { status: 400 },
    );
  }

  const pid = `${toSafeSlug(data.programKey)}-${toSafeSlug(data.location)}-${periodSlug}`;

  const periodRef = db.collection('donationPeriods').doc(pid);

  try {
    await periodRef.create({
      pid,
      programKey: data.programKey,
      programLabel: PROGRAM_LABELS[data.programKey] ?? data.programKey,
      location: data.location,
      periodLabel: data.periodLabel,
      startDate: Timestamp.fromDate(new Date(data.startDate)),
      endDate: Timestamp.fromDate(new Date(data.endDate)),
      pricingTiers: data.pricingTiers,
      ...(data.amountTiers !== undefined ? { amountTiers: data.amountTiers } : {}),
      paymentSource: data.paymentSource,
      enabled: data.enabled,
      createdAt: now,
      createdBy: session.uid,
      updatedAt: now,
      updatedBy: session.uid,
    });
  } catch (err) {
    // Firestore ALREADY_EXISTS gRPC code = 6
    if ((err as { code?: number }).code === 6) {
      return NextResponse.json({ error: 'pid-conflict', pid }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ pid, overlapWarning: overlaps }, { status: 201 });
}
