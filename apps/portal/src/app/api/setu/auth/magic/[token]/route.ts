import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { consumeMagicLink } from '@/features/setu/auth/magic-links';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import {
  buildSessionClaimsForContact,
  hasSession,
} from '@/features/setu/auth/build-session-claims';

function safeFrom(from: string | null): string | null {
  if (!from) return null;
  if (!from.startsWith('/')) return null;
  if (from.startsWith('//')) return null;
  if (from.includes('://')) return null;
  return from;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const { token } = await params;

  const consumed = await consumeMagicLink(token);
  if (!consumed) {
    // Token expired, already used, or not found — redirect to sign-in with error
    const url = new URL('/sign-in', req.url);
    url.searchParams.set('error', 'magic-link-invalid');
    return NextResponse.redirect(url);
  }

  const sessionResult = await buildSessionClaimsForContact({
    type: 'email',
    value: consumed.email,
    contactProvenance: 'magic-link',
  });

  if (!hasSession(sessionResult)) {
    // No family found for this contact — redirect to register
    const url = new URL(sessionResult.redirectTo, req.url);
    return NextResponse.redirect(url);
  }

  const { uid, claims, redirectTo: baseRedirectTo } = sessionResult;

  const reqUrl = new URL(req.url);
  const fromParam = reqUrl.searchParams.get('from');
  const redirectTo = safeFrom(fromParam) ?? baseRedirectTo;

  const auth = portalAuth();
  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);
  const idToken = await exchangeCustomTokenForIdToken(customToken);

  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '30');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.redirect(new URL(redirectTo, req.url));
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
