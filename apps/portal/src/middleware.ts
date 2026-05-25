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
        // Honor ?from= for the invite/accept flow: a signed-out user clicks
        // "Accept" → 401 → bounced to /sign-in?from=/invite/{token}. After
        // they sign in (which arrives back here as a signed-in user), we
        // need to send them BACK to the invite page, not their dashboard.
        const from = req.nextUrl.searchParams.get('from');
        const target = safeFrom(from) ?? dashboard;
        return NextResponse.redirect(new URL(target, req.nextUrl.origin));
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
  // Multi-role: comma-separated extras so downstream routes can build a full
  // claims object via the role helpers (hasRole / isAdmin / isWelcomeTeam).
  if (Array.isArray(claims.extraRoles) && claims.extraRoles.length > 0) {
    reqHeaders.set('x-portal-extra-roles', claims.extraRoles.join(','));
  }

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('x-portal-role', claims.role);
  res.headers.set('x-portal-uid', claims.uid);
  if (claims.familyId) res.headers.set('x-portal-family-id', claims.familyId);
  if (claims.fid) res.headers.set('x-portal-fid', claims.fid);
  if (claims.mid) res.headers.set('x-portal-mid', claims.mid);
  if (Array.isArray(claims.extraRoles) && claims.extraRoles.length > 0) {
    res.headers.set('x-portal-extra-roles', claims.extraRoles.join(','));
  }
  return res;
}

function dashboardForRole(role: unknown): string | null {
  if (role === 'family-manager' || role === 'family-member') return '/family';
  if (role === 'admin') return '/admin';
  if (role === 'welcome-team') return '/welcome';
  return null;
}

// Only allow internal, non-protocol-relative paths. Rejects ?from=//evil.com
// and ?from=https://evil.com to avoid open-redirect issues.
function safeFrom(from: string | null): string | null {
  if (!from) return null;
  if (!from.startsWith('/')) return null;
  if (from.startsWith('//')) return null;
  if (from.includes('://')) return null;
  return from;
}

function deny(req: NextRequest, reason: 'no-session' | 'unauthorized') {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  if (isApi) {
    return NextResponse.json({ error: reason }, { status: 401 });
  }
  // Setu routes (family + welcome-team + new /admin) redirect to the new
  // /sign-in. Legacy /check-in/admin still goes to legacy /login (will be
  // retired in Slice 5 cutover).
  const isSetuRoute =
    pathname === '/family' || pathname.startsWith('/family/') ||
    pathname === '/welcome' || pathname.startsWith('/welcome/') ||
    pathname === '/admin' || pathname.startsWith('/admin/');
  const loginPath = isSetuRoute ? '/sign-in' : '/login';
  const redirect = new URL(loginPath, req.nextUrl.origin);
  redirect.searchParams.set('from', pathname);
  redirect.searchParams.set('error', reason === 'no-session' ? 'session-expired' : 'unauthorized');
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.gif$|.*\\.webp$|.*\\.ico$).*)'],
  runtime: 'nodejs',
};
