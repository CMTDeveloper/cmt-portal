import { NextResponse, type NextRequest } from 'next/server';
import {
  verifyPortalSessionCookie,
  verifyPortalIdToken,
} from '@cmt/firebase-shared/admin/session';
import { isPublicRoute, canAccessRoute, type SessionClaims } from '@cmt/shared-domain';

// Public auth-entry pages. If a signed-in user lands on one of these, send
// them straight to their dashboard instead of showing the marketing/sign-in UI.
const AUTH_ENTRY_ROUTES = new Set(['/', '/sign-in', '/register', '/register/family']);

// Parsed once per cold start. Comma-separated list of origins allowed to call
// /api/*. Empty/unset → no CORS headers emitted (same-origin web only).
// Used by mobile dev (Expo dev server, Capacitor file://) and any future
// non-portal client.
function corsOrigins(): Set<string> {
  return new Set(
    (process.env.MOBILE_CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function applyCors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get('origin');
  if (!origin) return res;
  const allowed = corsOrigins();
  if (allowed.size === 0 || !allowed.has(origin)) return res;
  res.headers.set('access-control-allow-origin', origin);
  res.headers.set('vary', 'Origin');
  res.headers.set('access-control-allow-credentials', 'true');
  res.headers.set('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.headers.set('access-control-allow-headers', 'authorization,content-type');
  res.headers.set('access-control-max-age', '86400');
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CORS preflight for /api/*. Mobile dev origins call /api/setu/* + bearer.
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return applyCors(req, new NextResponse(null, { status: 204 }));
  }

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

  if (isPublicRoute(pathname)) {
    return pathname.startsWith('/api/')
      ? applyCors(req, NextResponse.next())
      : NextResponse.next();
  }

  // Portal-native teacher attendance (Slice 4c) is hidden by default — the
  // standalone check-in app owns attendance; the portal only reads
  // family-check-ins. Flip NEXT_PUBLIC_FEATURE_SETU_TEACHER=true to re-enable.
  if (
    process.env.NEXT_PUBLIC_FEATURE_SETU_TEACHER !== 'true' &&
    (pathname === '/teacher' ||
      pathname.startsWith('/teacher/') ||
      pathname.startsWith('/api/setu/teacher/'))
  ) {
    return pathname.startsWith('/api/')
      ? applyCors(req, NextResponse.json({ error: 'not-found' }, { status: 404 }))
      : NextResponse.redirect(new URL('/family', req.nextUrl.origin));
  }

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

  if (!claims) {
    const denied = deny(req, 'no-session');
    return pathname.startsWith('/api/') ? applyCors(req, denied) : denied;
  }
  if (!canAccessRoute(claims, pathname, req.method)) {
    const denied = deny(req, 'unauthorized');
    return pathname.startsWith('/api/') ? applyCors(req, denied) : denied;
  }

  const reqHeaders = new Headers(req.headers);
  // SECURITY: reqHeaders is a COPY of the inbound request headers, so a client
  // could send a forged x-portal-* header. Every claim header below MUST be
  // set-or-DELETED unconditionally from the verified claims — never a bare
  // `if (claims.x) set(...)`, which would let a forged inbound value survive
  // when the claim is absent (e.g. x-portal-email on a phone-only session,
  // which would defeat the invite/accept email-match guard). setOrDelete()
  // enforces that for every header.
  const setOrDelete = (name: string, value: string | null | undefined) => {
    if (value) reqHeaders.set(name, value);
    else reqHeaders.delete(name);
  };
  setOrDelete('x-portal-role', claims.role);
  setOrDelete('x-portal-uid', claims.uid);
  setOrDelete('x-portal-family-id', claims.familyId);
  setOrDelete('x-portal-fid', claims.fid);
  setOrDelete('x-portal-mid', claims.mid);
  // Multi-role: comma-separated extras so downstream routes can build a full
  // claims object via the role helpers (hasRole / isAdmin / isWelcomeTeam).
  setOrDelete(
    'x-portal-extra-roles',
    Array.isArray(claims.extraRoles) && claims.extraRoles.length > 0
      ? claims.extraRoles.join(',')
      : null,
  );
  // Verified contact from the token claims — lets Bearer (mobile) callers use
  // routes that need the signed-in contact (set-password, invite/accept,
  // contacts verify). Request headers only; never echoed to the browser.
  setOrDelete('x-portal-email', claims.email);
  setOrDelete('x-portal-phone', claims.phone);

  // Forward the claims to the downstream route handler via the REQUEST headers
  // only (the x-middleware-request-* mechanism). Do NOT write them onto the
  // response headers — that would leak role/uid/fid/mid/extraRoles to the
  // browser. Route handlers read these via headers().get('x-portal-*').
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  return pathname.startsWith('/api/') ? applyCors(req, res) : res;
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
    pathname === '/complete-profile' || pathname.startsWith('/complete-profile/') ||
    pathname === '/disclaimers' || pathname.startsWith('/disclaimers/') ||
    pathname === '/welcome' || pathname.startsWith('/welcome/') ||
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/docs' || pathname.startsWith('/docs/') ||
    // Token-link pages (public, but harden the destination): if ever auth-gated,
    // send the manager/invitee to the Setu /sign-in, never the legacy /login.
    pathname.startsWith('/join-request/') || pathname.startsWith('/invite/');
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
