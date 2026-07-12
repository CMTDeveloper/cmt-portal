import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { assignTeacher, getTeacherLevelIds } from '@/features/setu/teacher/assignments';
import { findMissingLevelIds } from '@/features/setu/teacher/levels';
import {
  assertWritableYear,
  PastYearWriteError,
} from '@/features/setu/rollover/assert-writable-year';
import { schoolYearOfPid } from '@/features/setu/rollover/school-year';

// Per-level teacher add/remove. POST unions this levelId into the teacher's set;
// DELETE subtracts it. BOTH route through assignTeacher so the two sources of
// truth — teacherAssignments/{mid}.levelIds AND levels/{id}.teacherRefs — stay
// in sync in one batch (never write teacherRefs directly here). Writable by
// admin AND welcome-team (front-desk flexibility); past school years are
// read-only history.
const BodySchema = z.object({ mid: z.string().trim().min(1) });

async function guard(
  req: Request,
  levelId: string,
): Promise<{ err?: NextResponse; byUid?: string }> {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return { err: NextResponse.json({ error: 'no-session' }, { status: 401 }) };
  }
  if (!isAdmin(session) && !isWelcomeTeam(session)) {
    return { err: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  // Reject a non-existent level BEFORE assignTeacher — its set-with-merge would
  // otherwise create a phantom partial level doc via the denormalized write.
  const missing = await findMissingLevelIds([levelId]);
  if (missing.length > 0) {
    return { err: NextResponse.json({ error: 'unknown-levels', missing }, { status: 400 }) };
  }
  const db = portalFirestore();
  const snap = await db.collection('levels').doc(levelId).get();
  const pid = snap.data()?.pid as string | undefined;
  try {
    if (pid) await assertWritableYear(db, schoolYearOfPid(pid));
  } catch (e) {
    if (e instanceof PastYearWriteError) {
      return {
        err: NextResponse.json(
          { error: 'past-year', year: e.year, liveYear: e.liveYear },
          { status: 409 },
        ),
      };
    }
    throw e;
  }
  return { byUid: session.uid };
}

export async function POST(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  const g = await guard(req, levelId);
  if (g.err) return g.err;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { mid } = parsed.data;
  const next = [...new Set([...(await getTeacherLevelIds(mid)), levelId])];
  const { added, removed } = await assignTeacher({ ref: mid, levelIds: next, byUid: g.byUid! });
  return NextResponse.json({ ref: mid, levelId, added, removed });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  const g = await guard(req, levelId);
  if (g.err) return g.err;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { mid } = parsed.data;
  const next = (await getTeacherLevelIds(mid)).filter((l) => l !== levelId);
  const { added, removed } = await assignTeacher({ ref: mid, levelIds: next, byUid: g.byUid! });
  // Removing the Lead teacher must not leave a dangling lead pointer at a mid that
  // no longer teaches the level. Clear it in the same request.
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(levelId).get();
  if (levelSnap.data()?.leadTeacherRef === mid) {
    await db.collection('levels').doc(levelId).update({ leadTeacherRef: null });
  }
  return NextResponse.json({ ref: mid, levelId, added, removed });
}
