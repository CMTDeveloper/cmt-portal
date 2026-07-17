import type { SessionClaims } from './session';
import { isPublicRoute } from './public-routes';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isSetuManager, isWelcomeTeam, isKiosk } from './role';

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
  // Authenticated Setu kiosk endpoints (door tablet) - NOT public. Covers the
  // lookup (GET .../setu/lookup) + submit (POST .../setu/check-in) paths and any
  // future Setu kiosk path in one prefix. The dedicated least-privilege `kiosk`
  // role authorizes them; admin inherits kiosk. Must have an explicit rule (this
  // prefix matches none of the four /api/check-in/* prefixes above - none start
  // with `setu` - and would otherwise fall through to the final default-deny).
  if (pathname.startsWith('/api/check-in/setu/')) return isKiosk(claims) || isAdmin(claims);

  // New /admin/* surface (Setu-themed). Pages and APIs both admin-only.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return isAdmin(claims);
  // Teacher assignment is writable by admin AND welcome-team (RBB-2 front-desk
  // flexibility). Must be checked BEFORE the generic admin-only /api/admin/ rule.
  if (
    pathname === '/api/admin/teacher-assignments' ||
    pathname.startsWith('/api/admin/teacher-assignments/')
  ) {
    return isAdmin(claims) || isWelcomeTeam(claims);
  }
  // Managed class calendar is published by admin AND welcome-team. Must be
  // checked before the generic admin-only /api/admin/ rule.
  if (pathname === '/api/admin/calendar' || pathname.startsWith('/api/admin/calendar/')) {
    return isAdmin(claims) || isWelcomeTeam(claims);
  }
  // Teacher name-search — front-desk (welcome-team) may assign teachers too.
  // Distinct prefix from /api/admin/teacher-assignments (handled above). Must be
  // checked before the generic admin-only /api/admin/ rule.
  if (pathname === '/api/admin/teachers/search' || pathname.startsWith('/api/admin/teachers/')) {
    return isAdmin(claims) || isWelcomeTeam(claims);
  }
  // Per-level teacher add/remove — admin + welcome-team (front-desk). Only the
  // `/teachers` sub-path opens up; level CRUD stays admin-only via the catch-all.
  if (/^\/api\/admin\/levels\/[^/]+\/teachers\/?$/.test(pathname)) {
    return isAdmin(claims) || isWelcomeTeam(claims);
  }
  if (pathname.startsWith('/api/admin/')) return isAdmin(claims);

  // Setu teacher portal — pages + APIs gated on the teacher capability
  // (admin inherits teacher via isTeacher).
  if (pathname === '/teacher' || pathname.startsWith('/teacher/')) {
    return isTeacher(claims);
  }
  if (pathname.startsWith('/api/setu/teacher/')) {
    return isTeacher(claims);
  }

  // Staff documentation hub (/docs): admin + welcome-team + teacher. Family
  // roles are excluded until family-facing guides exist; per-guide audience
  // filtering happens in the page (registry-driven).
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return isWelcomeTeam(claims) || isTeacher(claims);
  }

  // Setu family portal pages
  if (pathname === '/family' || pathname.startsWith('/family/')) {
    return isSetuFamily(claims);
  }

  // Profile-completion screen — a top-level route (NOT under /family, to avoid the
  // gate redirect loop) that the /family gate sends an incomplete family to.
  // Reachable by any signed-in Setu family member.
  if (pathname === '/complete-profile' || pathname.startsWith('/complete-profile/')) {
    return isSetuFamily(claims);
  }

  // Acknowledgements accept screen — a top-level route (NOT under /family, to avoid
  // the gate redirect loop) that the /family gate sends a not-yet-accepted manager to.
  if (pathname === '/acknowledgements' || pathname.startsWith('/acknowledgements/')) {
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

  // Setu API - family: GET any family role; PATCH (family-level edits) manager-only.
  if (pathname === '/api/setu/family' || pathname.startsWith('/api/setu/family/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'PATCH') return isSetuManager(claims);
    return true;
  }

  // Setu API — family dashboard aggregate (GET; any family role, mobile home).
  if (pathname === '/api/setu/dashboard') {
    return isSetuFamily(claims);
  }

  // Member profile read — any setu family (own-family enforced in the handler)
  // OR welcome-team/admin (front-desk family support). Must precede the
  // members rule below (isSetuFamily-only, which would block welcome-team).
  if (pathname.startsWith('/api/setu/members/') && pathname.endsWith('/profile')) {
    return isSetuFamily(claims) || isWelcomeTeam(claims);
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
  // POST /api/setu/invite/send and /api/setu/invite/cancel are intentionally NOT
  // covered here — they fall through to the catch-all below and are manager +
  // welcome-team + admin only (the handlers further enforce own-family scope).
  if (
    pathname.startsWith('/api/setu/invite/') &&
    !pathname.startsWith('/api/setu/invite/send') &&
    !pathname.startsWith('/api/setu/invite/cancel')
  ) {
    return claims.role != null;
  }

  // Setu API — join-request flow (member→manager request to join a family).
  //   - POST /api/setu/join-request/send is OPEN to any caller (incl. no role):
  //     the requester may not have a session yet, exactly like the public
  //     lookup. The handler is IP rate-limited and resolves fid/matchedMid
  //     server-side from the supplied contact. Must precede the manager-only
  //     paths below and the catch-all.
  //   - GET /api/setu/join-request/{token}, POST .../approve, POST .../decline
  //     are manager-only (the handler also enforces claims.fid === request.fid).
  if (pathname === '/api/setu/join-request/send') {
    return true;
  }
  if (pathname.startsWith('/api/setu/join-request/')) {
    return isSetuManager(claims);
  }

  // Setu API — set-password is reachable by any authenticated Setu user (self-service)
  if (pathname === '/api/setu/auth/set-password') {
    return isSetuFamily(claims) || isWelcomeTeam(claims) || isAdmin(claims);
  }

  // Setu API — programs list: readable by any setu family or welcome-team (mobile + web)
  if (pathname === '/api/setu/programs' || pathname.startsWith('/api/setu/programs/')) {
    return isSetuFamily(claims) || isWelcomeTeam(claims);
  }

  // Setu API — centre locations: read-only list for the registration + member
  // forms. PUBLIC (in PUBLIC_ROUTES) so the pre-auth picker reads it; this clause
  // just confirms any signed-in setu family may read it too. Writes go through
  // /api/admin/locations (admin).
  if (
    pathname === '/api/setu/locations' ||
    pathname.startsWith('/api/setu/locations/')
  ) {
    return isSetuFamily(claims);
  }

  // Setu API — volunteering-skill options: read-only list for the member
  // add/edit forms. Any signed-in setu family (incl. a family-member editing
  // their own profile). Writes go through /api/admin/volunteering-skills (admin).
  if (
    pathname === '/api/setu/volunteering-skills' ||
    pathname.startsWith('/api/setu/volunteering-skills/')
  ) {
    return isSetuFamily(claims);
  }

  // Setu API — seva: browse opportunities + sign up + cancel. Any signed-in
  // setu family (handlers bind fid from the session and verify ownership).
  if (pathname === '/api/setu/seva' || pathname.startsWith('/api/setu/seva/')) {
    return isSetuFamily(claims);
  }

  // Setu API — enrollments: GET is any setu family; POST/DELETE is manager-only
  if (pathname === '/api/setu/enrollments' || pathname.startsWith('/api/setu/enrollments/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST' || method === 'DELETE') return isSetuManager(claims);
    return true;
  }

  // Setu API — donations: GET list is any setu family; POST (checkout) is
  // manager-only (a family-member can view history but not initiate a payment).
  if (pathname === '/api/setu/donations' || pathname.startsWith('/api/setu/donations/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST') return isSetuManager(claims);
    return true;
  }

  // NOTE: /api/welcome/donations/* authorization stays absent until its handlers
  // ship. Authorizing paths without handlers silently passes requests that
  // should get 404/501.

  // Welcome-team API — roster browse/filter/CSV + migration reconciliation.
  if (pathname === '/api/welcome/families' || pathname.startsWith('/api/welcome/families/')) {
    return isWelcomeTeam(claims);
  }

  // Welcome-team API - single-page roster report (browse/filter dataset + CSV).
  if (pathname === '/api/welcome/roster' || pathname.startsWith('/api/welcome/roster/')) {
    return isWelcomeTeam(claims);
  }

  // Welcome-team API — prasad day-of lists (read-only).
  if (pathname === '/api/welcome/prasad' || pathname.startsWith('/api/welcome/prasad/')) {
    return isWelcomeTeam(claims);
  }

  // Welcome-team API — enrollments only (donations routes ship in slice 3c)
  if (
    pathname.startsWith('/api/welcome/enrollments/') ||
    pathname === '/api/welcome/enrollments'
  ) {
    return isWelcomeTeam(claims);
  }

  // Seva management — opportunities + (later) signup rosters + confirmations: admin + welcome-team.
  if (pathname === '/api/welcome/seva' || pathname.startsWith('/api/welcome/seva/')) {
    return isWelcomeTeam(claims);
  }

  // Welcome-team API — reports hub (enrollment + attendance). The donations
  // report was removed (no collective financial info in the reports hub).
  if (pathname === '/api/welcome/reports' || pathname.startsWith('/api/welcome/reports/')) {
    return isWelcomeTeam(claims);
  }

  // Setu API — published class calendar is readable by ANY signed-in user
  // (families incl. family-member, teachers). Returns only enabled entries;
  // writes go through /api/admin/calendar (admin + welcome-team).
  if (pathname === '/api/setu/calendar' || pathname.startsWith('/api/setu/calendar/')) {
    return claims.role != null;
  }

  // Setu API — "My contacts" self-service: any signed-in family role (incl.
  // family-member) may add/verify their OWN contacts and dismiss the nudge.
  // The route handlers bind every write to the caller's own mid and run the
  // anti-theft contactKey check, so member-level access is safe here.
  if (pathname === '/api/setu/contacts' || pathname.startsWith('/api/setu/contacts/')) {
    return isSetuFamily(claims);
  }

  // Setu API — prasad: any family role may view their assignment/options;
  // the move POST is manager-only. Must precede the manager-only catch-all.
  if (pathname === '/api/setu/prasad' || pathname.startsWith('/api/setu/prasad/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST') return isSetuManager(claims);
    return true;
  }

  // Disclaimers: GET state = any setu family; POST accept = manager-only.
  if (pathname === '/api/setu/disclaimers' || pathname.startsWith('/api/setu/disclaimers/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST') return isSetuManager(claims);
    return true;
  }

  // Setu API — remaining paths (invite/send, register, etc.): manager + welcome-team + admin
  // family-member is NOT included here; manager-level is the safe default for unknown setu paths
  if (pathname.startsWith('/api/setu/')) {
    return isSetuManager(claims) || isWelcomeTeam(claims) || isAdmin(claims);
  }

  return false;
}
