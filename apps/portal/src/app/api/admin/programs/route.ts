import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { CreateProgramSchema, isAdmin, toSafeSlug } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { listPrograms } from '@/features/setu/programs/get-programs';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const db = portalFirestore();
  const snap = await db.collection('programs').orderBy('displayOrder', 'asc').get();
  const programs = snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      createdAt: (data['createdAt'] as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      updatedAt: (data['updatedAt'] as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
    };
  });
  return NextResponse.json({ programs });
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
  const parsed = CreateProgramSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const programKey = data.programKey ?? toSafeSlug(data.label);
  if (!programKey) {
    return NextResponse.json(
      { error: 'invalid-label', message: 'Label must contain alphanumeric characters' },
      { status: 400 },
    );
  }

  const db = portalFirestore();
  const now = FieldValue.serverTimestamp();
  const programRef = db.collection('programs').doc(programKey);

  try {
    await programRef.create({
      programKey,
      label: data.label,
      shortDescription: data.shortDescription,
      status: data.status,
      locations: data.locations,
      termType: data.termType,
      eligibility: data.eligibility,
      capabilities: data.capabilities,
      displayOrder: data.displayOrder,
      createdAt: now,
      createdBy: session.uid,
      updatedAt: now,
      updatedBy: session.uid,
    });
  } catch (err) {
    // Firestore ALREADY_EXISTS gRPC code = 6
    if ((err as { code?: number }).code === 6) {
      return NextResponse.json({ error: 'programKey-conflict', programKey }, { status: 409 });
    }
    throw err;
  }

  revalidateTag('programs', 'max');
  return NextResponse.json({ programKey }, { status: 201 });
}
