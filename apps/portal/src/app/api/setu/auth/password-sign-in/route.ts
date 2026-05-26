import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkAndRecordOtpRateLimit, normalizeContact } from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import {
  buildSessionClaimsForContact,
  hasSession,
} from '@/features/setu/auth/build-session-claims';
import { firebaseSignInWithPassword } from '@/features/setu/auth/firebase-rest';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mode: z.enum(['web', 'mobile']).optional(),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const normalized = normalizeContact('email', email);

  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'too-many-requests', resetAt: rate.resetAt }, { status: 429 });
  }

  const signInResult = await firebaseSignInWithPassword({ email, password });

  if (!signInResult.ok) {
    switch (signInResult.error) {
      case 'invalid-credentials':
        return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 });
      case 'user-disabled':
        return NextResponse.json({ error: 'user-disabled' }, { status: 403 });
      case 'too-many-requests':
        return NextResponse.json({ error: 'too-many-requests' }, { status: 429 });
      default:
        return NextResponse.json({ error: 'network' }, { status: 500 });
    }
  }

  const sessionResult = await buildSessionClaimsForContact({
    type: 'email',
    value: email,
    contactProvenance: 'password',
  });

  if (!hasSession(sessionResult)) {
    return NextResponse.json({ redirectTo: sessionResult.redirectTo }, { status: 200 });
  }

  const { uid, claims, redirectTo: baseRedirectTo } = sessionResult;

  const reqUrl = new URL(req.url);
  const urlMode = reqUrl.searchParams.get('mode');
  const mode = urlMode === 'mobile' || parsed.data.mode === 'mobile' ? 'mobile' : 'web';

  let redirectTo = baseRedirectTo;
  const fromParam = reqUrl.searchParams.get('from');
  if (fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//')) {
    redirectTo = fromParam;
  }

  const auth = portalAuth();
  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);

  if (mode === 'mobile') {
    return NextResponse.json({ customToken }, { status: 200 });
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ redirectTo }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
