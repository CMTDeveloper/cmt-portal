import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { CreateLevelSchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { levelIdFor } from '@/features/setu/teacher/levels';

type TS = ReturnType<typeof Timestamp.now>;

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const db = portalFirestore();
  const snap = await db
    .collection('levels')
    .orderBy('location', 'asc')
    .orderBy('order', 'asc')
    .get();
  const levels = snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      createdAt: (data.createdAt as TS).toDate().toISOString(),
      updatedAt: (data.updatedAt as TS).toDate().toISOString(),
    };
  });
  return NextResponse.json({ levels });
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
  const parsed = CreateLevelSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;
  const levelId = levelIdFor(data.location, data.levelName, data.pid);
  if (!levelId || levelId.startsWith('-') || levelId.endsWith('-')) {
    return NextResponse.json(
      { error: 'invalid-level-name', message: 'Level name must contain alphanumeric characters' },
      { status: 400 },
    );
  }

  const db = portalFirestore();
  // Snapshot the period label so the level shows it without a join.
  const periodSnap = await db.collection('donationPeriods').doc(data.pid).get();
  if (!periodSnap.exists) {
    return NextResponse.json({ error: 'period-not-found', pid: data.pid }, { status: 400 });
  }
  const periodLabel = (periodSnap.data()?.periodLabel as string | undefined) ?? data.pid;

  const now = FieldValue.serverTimestamp();
  try {
    await db.collection('levels').doc(levelId).create({
      levelId,
      programKey: data.programKey,
      location: data.location,
      levelName: data.levelName,
      levelKind: data.levelKind,
      order: data.order,
      gradeBand: data.gradeBand,
      ageLabel: data.ageLabel,
      curriculum: data.curriculum,
      pid: data.pid,
      periodLabel,
      teacherRefs: [],
      enabled: data.enabled,
      createdAt: now,
      createdBy: session.uid,
      updatedAt: now,
      updatedBy: session.uid,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 6) {
      return NextResponse.json({ error: 'level-conflict', levelId }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ levelId }, { status: 201 });
}
