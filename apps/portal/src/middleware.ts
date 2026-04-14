import { NextResponse, type NextRequest } from 'next/server';
import {
  verifyPortalSessionCookie,
  verifyPortalIdToken,
} from '@cmt/firebase-shared/admin/session';
import { isPublicRoute, canAccessRoute, type SessionClaims } from '@cmt/shared-domain';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicRoute(pathname)) return NextResponse.next();

  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const cookie = req.cookies.get('__session')?.value;

  let claims: SessionClaims | null = null;
  if (bearer) {
    const decoded = await verifyPortalIdToken(bearer);
    if (decoded && decoded.role) claims = decoded as unknown as SessionClaims;
  } else if (cookie) {
    const decoded = await verifyPortalSessionCookie(cookie);
    if (decoded && decoded.role) claims = decoded as unknown as SessionClaims;
  }

  if (!claims) return deny(req, 'no-session');
  if (!canAccessRoute(claims, pathname)) return deny(req, 'unauthorized');

  const headers = new Headers(req.headers);
  headers.set('x-portal-role', claims.role);
  headers.set('x-portal-uid', claims.uid);
  if (claims.familyId) headers.set('x-portal-family-id', claims.familyId);
  return NextResponse.next({ request: { headers } });
}

function deny(req: NextRequest, reason: 'no-session' | 'unauthorized') {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  if (isApi) {
    return NextResponse.json({ error: reason }, { status: 401 });
  }
  const redirect = new URL('/login', req.nextUrl.origin);
  redirect.searchParams.set('from', req.nextUrl.pathname);
  redirect.searchParams.set('error', reason === 'no-session' ? 'session-expired' : 'unauthorized');
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs',
};
