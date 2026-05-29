import { NextResponse } from 'next/server';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getMyLevels } from '@/features/setu/teacher/levels';

// "My levels" for the signed-in teacher. The assignment ref is the member mid
// (parent-teachers); teacher-only (tid) sign-in is a later step.
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const levels = await getMyLevels(session.mid);
  return NextResponse.json({
    levels: levels.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
  });
}
