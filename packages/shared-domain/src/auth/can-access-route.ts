import type { SessionClaims } from './session';
import { isPublicRoute } from './public-routes';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isSetuManager, isWelcomeTeam } from './role';

export function canAccessRoute(
  claims: SessionClaims,
  pathname: string,
  method: string = 'GET',
): boolean {
  if (isPublicRoute(pathname)) return true;

  if (pathname === '/check-in/admin' || pathname.startsWith('/check-in/admin/')) {
    return isAdmin(claims);
  }
  if (pathname === '/check-in/teacher' || pathname.startsWith('/check-in/teacher/')) {
    return isTeacher(claims);
  }
  if (pathname === '/check-in/family' || pathname.startsWith('/check-in/family/')) {
    return isFamily(claims);
  }

  if (pathname.startsWith('/api/check-in/admin/')) return isAdmin(claims);
  if (pathname.startsWith('/api/check-in/teacher/')) return isTeacher(claims);
  if (pathname.startsWith('/api/check-in/family/')) return isFamily(claims);
  if (pathname.startsWith('/api/check-in/notifications/')) return isAdmin(claims);

  // New /admin/* surface (Setu-themed). Pages and APIs both admin-only.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return isAdmin(claims);
  if (pathname.startsWith('/api/admin/')) return isAdmin(claims);

  // Setu family portal pages
  if (pathname === '/family' || pathname.startsWith('/family/')) {
    return isSetuFamily(claims);
  }

  // Welcome-team portal pages
  if (pathname === '/welcome' || pathname.startsWith('/welcome/')) {
    return isWelcomeTeam(claims);
  }

  // Setu API — family search is welcome-team only
  if (pathname === '/api/setu/family/search' || pathname.startsWith('/api/setu/family/search')) {
    return isWelcomeTeam(claims);
  }

  // Setu API — family read (GET only; no mutations on this path currently)
  if (pathname === '/api/setu/family' || pathname.startsWith('/api/setu/family/')) {
    return isSetuFamily(claims);
  }

  // Setu API — member mutations: POST and DELETE are manager-only.
  // PATCH on /api/setu/members/{mid} allows a member to edit their own profile
  // (self-edit) — the route handler enforces that manager flag cannot change.
  if (pathname === '/api/setu/members' || pathname.startsWith('/api/setu/members/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST' || method === 'DELETE') return isSetuManager(claims);
    if (method === 'PATCH') {
      if (isSetuManager(claims)) return true;
      // family-member self-edit: path must end with their own mid
      const targetMid = pathname.startsWith('/api/setu/members/')
        ? pathname.slice('/api/setu/members/'.length)
        : null;
      return targetMid !== null && targetMid === (claims as { mid?: string }).mid;
    }
    return isSetuFamily(claims);
  }

  // Setu API — invite accept and invite GET ({token}) are reachable by ANY
  // signed-in user. The route handlers enforce their own auth:
  //   - GET /api/setu/invite/{token} returns only non-sensitive metadata.
  //   - POST /api/setu/invite/accept requires the invitee's verified contact
  //     to match the invite email; a fresh OTP-signed-in invitee has
  //     role='family' (no fid yet) and must be allowed through middleware.
  // POST /api/setu/invite/send is intentionally NOT covered here — it falls
  // through to the catch-all below and is manager + welcome-team + admin only.
  if (
    pathname.startsWith('/api/setu/invite/') &&
    !pathname.startsWith('/api/setu/invite/send')
  ) {
    return claims.role != null;
  }

  // Setu API — set-password is reachable by any authenticated Setu user (self-service)
  if (pathname === '/api/setu/auth/set-password') {
    return isSetuFamily(claims) || isWelcomeTeam(claims) || isAdmin(claims);
  }

  // Setu API — remaining paths (invite/send, register, etc.): manager + welcome-team + admin
  // family-member is NOT included here; manager-level is the safe default for unknown setu paths
  if (pathname.startsWith('/api/setu/')) {
    return isSetuManager(claims) || isWelcomeTeam(claims) || isAdmin(claims);
  }

  return false;
}
