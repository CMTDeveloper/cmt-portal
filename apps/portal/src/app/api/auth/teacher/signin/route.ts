import { NextResponse } from 'next/server';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import {
  getOrCreateSharedTeacherUser,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ passphrase: z.string().min(1) });

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const expected = process.env.TEACHER_PASSPHRASE;
  if (!expected) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }
  if (!constantTimeEquals(parsed.data.passphrase, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await getOrCreateSharedTeacherUser();
  const customTok = await createPortalCustomToken(user.uid, { role: 'teacher' });
  const idTok = await exchangeCustomTokenForIdToken(customTok);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
  const session = await createPortalSessionCookie(idTok, expiresInDays);

  const res = NextResponse.json({ redirectTo: '/check-in/teacher' }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
