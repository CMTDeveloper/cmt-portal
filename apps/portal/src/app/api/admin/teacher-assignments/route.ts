import { NextResponse } from 'next/server';
import { AssignTeacherSchema, isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { assignTeacher } from '@/features/setu/teacher/assignments';

// Set the levels a teacher (member mid or standalone tid) covers. Writable by
// admin AND welcome-team (RBB-2 front-desk flexibility). The `teacher`
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

  const { ref, levelIds } = parsed.data;
  const { added, removed } = await assignTeacher({ ref, levelIds, byUid: session.uid });
  return NextResponse.json({ ref, levelIds, added, removed });
}
