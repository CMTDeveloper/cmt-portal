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
import { flags } from '@/lib/flags';
import {
  checkAndRecordOtpRateLimit,
  TEACHER_SIGNIN_RATE_LIMIT_MAX,
} from '@/features/check-in/shared';


const bodySchema = z.object({ passphrase: z.string().min(1) });

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  // Gate on the same flag as the teacher check-in UI/report routes — when the
  // legacy teacher flow is disabled, this sign-in endpoint 404s with it.
  if (!flags.checkInTeacher) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

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
    // Throttle brute force against the shared passphrase. Only FAILED guesses
    // consume the per-IP budget, so a correct sign-in never counts and many
    // legitimate teachers behind one venue NAT are not locked out.
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    const rate = await checkAndRecordOtpRateLimit(
      `teacher-signin:${ip}`,
      TEACHER_SIGNIN_RATE_LIMIT_MAX,
    );
    if (!rate.allowed) {
      return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await getOrCreateSharedTeacherUser();
  const customTok = await createPortalCustomToken(user.uid, { role: 'teacher' });
  const idTok = await exchangeCustomTokenForIdToken(customTok);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
  const session = await createPortalSessionCookie(idTok, expiresInDays);

  const res = NextResponse.json({ redirectTo: '/check-in/teacher' }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
