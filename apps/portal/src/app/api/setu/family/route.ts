import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const result = await getCurrentFamily();
  if (!result) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  return NextResponse.json(result, { status: 200 });
}
