import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { CreateLevelSchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { levelIdFor } from '@/features/setu/teacher/levels';
import { findNameConflict, normalizeLevelName } from '@/features/setu/teacher/level-name-conflict';
import { assignTeacher, getTeacherLevelIds } from '@/features/setu/teacher/assignments';
import {
  assertWritableYear,
  PastYearWriteError,
} from '@/features/setu/rollover/assert-writable-year';
import {
  resolveTeacherEmail,
  TeacherEmailResolutionError,
} from '@/features/setu/teacher/resolve-teacher-email';

type TS = ReturnType<typeof Timestamp.now>;

async function nextLevelOrder(
  db: ReturnType<typeof portalFirestore>,
  data: { programKey: string; location: string; pid: string },
): Promise<number> {
  const snap = await db.collection('levels').get();
  let max = -1;
  for (const doc of snap.docs) {
    const level = doc.data();
    if (
      level.programKey === data.programKey &&
      level.location === data.location &&
      level.pid === data.pid &&
      typeof level.order === 'number'
    ) {
      max = Math.max(max, level.order);
    }
  }
  return max + 1;
}

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

  // Past school years are read-only history; live + preparing stay editable.
  // periodLabel is the period's school-year string (e.g. "2025-26").
  try {
    await assertWritableYear(db, periodLabel);
  } catch (e) {
    if (e instanceof PastYearWriteError) {
      return NextResponse.json({ error: 'past-year', year: e.year, liveYear: e.liveYear }, { status: 409 });
    }
    throw e;
  }

  // Enforce normalized-name uniqueness within (location, period). The frozen
  // doc id only guards an exact-id clash; two levels can still share a display
  // name after a rename. Single-field pid read — no composite index.
  const conflict = await findNameConflict(db, {
    location: data.location,
    pid: data.pid,
    normalizedName: normalizeLevelName(data.levelName),
  });
  if (conflict) {
    return NextResponse.json({ error: 'level-conflict', levelId: conflict }, { status: 409 });
  }

  const order =
    data.order ??
    (await nextLevelOrder(db, {
      programKey: data.programKey,
      location: data.location,
      pid: data.pid,
    }));

  let teacher: Awaited<ReturnType<typeof resolveTeacherEmail>> | null = null;
  let teacherLevelIds: string[] | null = null;
  if (data.teacherEmail) {
    try {
      teacher = await resolveTeacherEmail(data.teacherEmail);
      teacherLevelIds = [...new Set([...(await getTeacherLevelIds(teacher.ref)), levelId])];
    } catch (err) {
      if (err instanceof TeacherEmailResolutionError) {
        const status = err.code === 'teacher-not-found' ? 404 : err.code === 'teacher-not-active' ? 409 : 400;
        return NextResponse.json({ error: err.code }, { status });
      }
      throw err;
    }
  }

  const now = FieldValue.serverTimestamp();
  try {
    await db.collection('levels').doc(levelId).create({
      levelId,
      programKey: data.programKey,
      location: data.location,
      levelName: data.levelName,
      levelKind: data.levelKind,
      order,
      gradeBand: data.gradeBand,
      // ageLabel is optional; never write `undefined` (Firestore rejects it and
      // exactOptionalPropertyTypes forbids the assignment).
      ...(data.ageLabel ? { ageLabel: data.ageLabel } : {}),
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
    if (teacher && teacherLevelIds) {
      await assignTeacher({ ref: teacher.ref, levelIds: teacherLevelIds, byUid: session.uid });
    }
  } catch (err) {
    if ((err as { code?: number }).code === 6) {
      return NextResponse.json({ error: 'level-conflict', levelId }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json(
    {
      levelId,
      order,
      teacherRef: teacher?.ref ?? null,
      teacherEmail: teacher?.email ?? null,
    },
    { status: 201 },
  );
}
