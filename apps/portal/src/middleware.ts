import { NextResponse, type NextRequest } from 'next/server';
import {
  verifyPortalSessionCookie,
  verifyPortalIdToken,
} from '@cmt/firebase-shared/admin/session';
import { isPublicRoute, canAccessRoute, type SessionClaims } from '@cmt/shared-domain';

// Public auth-entry pages. If a signed-in user lands on one of these, send
// them straight to their dashboard instead of showing the marketing/sign-in UI.
const AUTH_ENTRY_ROUTES = new Set(['/', '/sign-in', '/register', '/register/family']);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (AUTH_ENTRY_ROUTES.has(pathname)) {
    const cookie = req.cookies.get('__session')?.value;
    if (cookie) {
      const decoded = await verifyPortalSessionCookie(cookie).catch(() => null);
      const dashboard = dashboardForRole(decoded?.role);
      if (dashboard) {
        return NextResponse.redirect(new URL(dashboard, req.nextUrl.origin));
      }
    }
    return NextResponse.next();
  }

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
  if (!canAccessRoute(claims, pathname, req.method)) return deny(req, 'unauthorized');

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-portal-role', claims.role);
  reqHeaders.set('x-portal-uid', claims.uid);
  if (claims.familyId) reqHeaders.set('x-portal-family-id', claims.familyId);
  if (claims.fid) reqHeaders.set('x-portal-fid', claims.fid);
  if (claims.mid) reqHeaders.set('x-portal-mid', claims.mid);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('x-portal-role', claims.role);
  res.headers.set('x-portal-uid', claims.uid);
  if (claims.familyId) res.headers.set('x-portal-family-id', claims.familyId);
  if (claims.fid) res.headers.set('x-portal-fid', claims.fid);
  if (claims.mid) res.headers.set('x-portal-mid', claims.mid);
  return res;
}

function dashboardForRole(role: unknown): string | null {
  if (role === 'family-manager' || role === 'family-member') return '/family';
  if (role === 'welcome-team') return '/welcome';
  return null;
}

function deny(req: NextRequest, reason: 'no-session' | 'unauthorized') {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  if (isApi) {
    return NextResponse.json({ error: reason }, { status: 401 });
  }
  // Setu family routes redirect to /sign-in; legacy check-in routes keep /login
  const isSetuFamily = pathname === '/family' || pathname.startsWith('/family/');
  const loginPath = isSetuFamily ? '/sign-in' : '/login';
  const redirect = new URL(loginPath, req.nextUrl.origin);
  redirect.searchParams.set('from', pathname);
  redirect.searchParams.set('error', reason === 'no-session' ? 'session-expired' : 'unauthorized');
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.gif$|.*\\.webp$|.*\\.ico$).*)'],
  runtime: 'nodejs',
};
