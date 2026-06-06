import { NextResponse } from 'next/server';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilySevaView } from '@/features/setu/seva/get-family-seva-view';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ mySignups: [] });
  const view = await getFamilySevaView(session.fid);
  return NextResponse.json({ mySignups: view.mySignups });
}
