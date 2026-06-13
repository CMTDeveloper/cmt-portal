import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { getSessionFamily } from '@/features/setu/members/get-session-family';

// Header-based session (works for cookie AND Bearer/mobile callers) — the
// cookie-only getCurrentFamily() silently 401'd valid Bearer requests.
export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const result = await getSessionFamily(req);
  if (!result) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  return NextResponse.json(result, { status: 200 });
}
