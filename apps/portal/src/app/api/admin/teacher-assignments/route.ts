import { NextResponse } from 'next/server';
import { AssignTeacherSchema, isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { assignTeacher } from '@/features/setu/teacher/assignments';
import { findMissingLevelIds } from '@/features/setu/teacher/levels';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import {
  assertWritableYear,
  PastYearWriteError,
} from '@/features/setu/rollover/assert-writable-year';
import { schoolYearOfPid } from '@/features/setu/rollover/school-year';
import {
  resolveTeacherEmail,
  TeacherEmailResolutionError,
} from '@/features/setu/teacher/resolve-teacher-email';

// Set the levels a teacher covers. The preferred operator input is a teacher
// email that resolves to a registered member mid; legacy ref input is still
// accepted for scripted/back-compat paths. Writable by admin AND welcome-team
// (RBB-2 front-desk flexibility). The `teacher`
// capability is computed from the resulting doc at the person's next sign-in.
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session) && !isWelcomeTeam(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = AssignTeacherSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const { levelIds } = parsed.data;
  let ref = parsed.data.ref?.trim() ?? '';
  let teacherEmail: string | null = null;

  if (parsed.data.teacherEmail) {
    try {
      const resolved = await resolveTeacherEmail(parsed.data.teacherEmail);
      ref = resolved.ref;
      teacherEmail = resolved.email;
    } catch (err) {
      if (err instanceof TeacherEmailResolutionError) {
        const status = err.code === 'teacher-not-found' ? 404 : err.code === 'teacher-not-active' ? 409 : 400;
        return NextResponse.json({ error: err.code }, { status });
      }
      throw err;
    }
  }

  const missing = await findMissingLevelIds(levelIds);
  if (missing.length > 0) {
    return NextResponse.json({ error: 'unknown-levels', missing }, { status: 400 });
  }

  // Past school years are read-only history; live + preparing stay editable.
  // Each target level's school year comes from its `pid` (bv-{loc}-{year});
  // reject the whole write if ANY targeted level is in a past year.
  if (levelIds.length > 0) {
    const db = portalFirestore();
    const refs = [...new Set(levelIds)].map((id) => db.collection('levels').doc(id));
    const snaps = await db.getAll(...refs);
    try {
      for (const snap of snaps) {
        const pid = snap.data()?.pid as string | undefined;
        if (pid) await assertWritableYear(db, schoolYearOfPid(pid));
      }
    } catch (e) {
      if (e instanceof PastYearWriteError) {
        return NextResponse.json({ error: 'past-year', year: e.year, liveYear: e.liveYear }, { status: 409 });
      }
      throw e;
    }
  }

  const { added, removed } = await assignTeacher({ ref, levelIds, byUid: session.uid });
  return NextResponse.json({ ref, teacherEmail, levelIds, added, removed });
}
