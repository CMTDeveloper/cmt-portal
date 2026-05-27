import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import {
  CreateDonationPeriodSchema,
  type DonationPeriodDoc,
  isAdmin,
  ROLES,
  type Role,
} from '@cmt/shared-domain';

const PROGRAM_LABELS: Record<string, string> = {
  'bala-vihar': 'Bala Vihar',
};

export async function GET(req: Request) {
  const role = req.headers.get('x-portal-role');
  const extrasHeader = req.headers.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader.split(',').map((s) => s.trim()).filter((s): s is Role => (ROLES as readonly string[]).includes(s));
  if (!isAdmin({ role: role as Role, extraRoles })) {
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
  const role = req.headers.get('x-portal-role');
  const extrasHeader = req.headers.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader.split(',').map((s) => s.trim()).filter((s): s is Role => (ROLES as readonly string[]).includes(s));
  if (!isAdmin({ role: role as Role, extraRoles })) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const uid = req.headers.get('x-portal-uid');
  if (!uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
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

  const pid = `${data.programKey}-${data.location.toLowerCase()}-${data.periodLabel.toLowerCase().replace(/\s+/g, '-')}`;
  const periodRef = db.collection('donationPeriods').doc(pid);

  const existing = await periodRef.get();
  if (existing.exists) {
    return NextResponse.json({ error: 'pid-conflict', pid }, { status: 409 });
  }

  await periodRef.set({
    pid,
    programKey: data.programKey,
    programLabel: PROGRAM_LABELS[data.programKey] ?? data.programKey,
    location: data.location,
    periodLabel: data.periodLabel,
    startDate: Timestamp.fromDate(new Date(data.startDate)),
    endDate: Timestamp.fromDate(new Date(data.endDate)),
    suggestedAmount: data.suggestedAmount,
    amountTiers: data.amountTiers,
    enabled: data.enabled,
    createdAt: now,
    createdBy: uid,
    updatedAt: now,
    updatedBy: uid,
  });

  return NextResponse.json({ pid, overlapWarning: overlaps }, { status: 201 });
}
