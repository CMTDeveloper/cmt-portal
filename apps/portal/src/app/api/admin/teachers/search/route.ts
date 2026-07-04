import { NextResponse } from 'next/server';
import { isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { searchTeachers } from '@/features/setu/teacher/search-teachers';

// Teacher name-search for the assign-teacher-to-level flow. Admin AND
// welcome-team may search (RBB-2 front-desk flexibility). Reuses the family
// search (existing searchKeys index) — no new Firestore index.
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session) && !isWelcomeTeam(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return NextResponse.json({ hits: await searchTeachers(q) });
}
