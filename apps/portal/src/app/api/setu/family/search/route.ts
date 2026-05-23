import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { searchFamilies } from '@/features/setu/search/search-families';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'welcome-team') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (!q) {
    return NextResponse.json({ hits: [] }, { status: 200 });
  }

  const hits = await searchFamilies(q);
  return NextResponse.json({ hits }, { status: 200 });
}
