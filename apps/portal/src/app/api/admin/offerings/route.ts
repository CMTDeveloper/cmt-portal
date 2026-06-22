import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { CreateOfferingSchema, isAdmin, toSafeSlug } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getProgram } from '@/features/setu/programs/get-programs';
import { findOverlappingEnabledOffering, offeringOverlapPayload } from './overlap';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const db = portalFirestore();
  const snap = await db.collection('offerings').orderBy('startDate', 'desc').get();
  const offerings = snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      startDate: (data['startDate'] as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      endDate: data['endDate'] != null
        ? (data['endDate'] as ReturnType<typeof Timestamp.now>).toDate().toISOString()
        : null,
      createdAt: (data['createdAt'] as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      updatedAt: (data['updatedAt'] as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
    };
  });
  return NextResponse.json({ offerings });
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
  const parsed = CreateOfferingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const db = portalFirestore();
  const now = FieldValue.serverTimestamp();

  const termSlug = toSafeSlug(data.termLabel);
  if (!termSlug) {
    return NextResponse.json(
      { error: 'invalid-term-label', message: 'Term label must contain alphanumeric characters' },
      { status: 400 },
    );
  }

  const locationSlug = data.location != null ? toSafeSlug(data.location) : 'all';
  const oid = `${toSafeSlug(data.programKey)}-${locationSlug}-${termSlug}`;

  const overlap = await findOverlappingEnabledOffering(db, {
    programKey: data.programKey,
    location: data.location,
    enabled: data.enabled,
    startDate: new Date(data.startDate),
    endDate: data.endDate != null ? new Date(data.endDate) : null,
  });
  if (overlap) {
    return NextResponse.json(offeringOverlapPayload(overlap, data.location), { status: 409 });
  }

  // Look up programLabel from the programs registry; fall back to the key itself
  const program = await getProgram(data.programKey);
  const programLabel = program?.label ?? data.programKey;

  const offeringRef = db.collection('offerings').doc(oid);

  try {
    await offeringRef.create({
      oid,
      programKey: data.programKey,
      programLabel,
      location: data.location,
      termLabel: data.termLabel,
      termType: data.termType,
      startDate: Timestamp.fromDate(new Date(data.startDate)),
      endDate: data.endDate != null ? Timestamp.fromDate(new Date(data.endDate)) : null,
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
      return NextResponse.json(
        {
          error: 'oid-conflict',
          oid,
          message: `An offering already exists for ${data.location ?? 'all locations'} ${data.termLabel}. Edit the existing offering or choose a different term label.`,
        },
        { status: 409 },
      );
    }
    throw err;
  }

  revalidateTag('offerings', 'max');
  return NextResponse.json({ oid }, { status: 201 });
}
