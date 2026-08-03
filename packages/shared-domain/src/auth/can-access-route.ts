import type { SessionClaims } from './session';
import { isPublicRoute } from './public-routes';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isSetuManager, isWelcomeTeam, isKiosk, isCoordinator } from './role';

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
  // Kiosk PAGES - no longer public (removed from PUBLIC_ROUTES), gated to the
  // shared kiosk credential (admin inherits kiosk). Exact-match leaf pages so
  // they never collide with /check-in/staff-sign-in, /check-in/admin,
  // /check-in/teacher, or /check-in/family.
  if (pathname === '/check-in' || pathname === '/check-in/guest' || pathname === '/check-in/lookup') {
    return isKiosk(claims) || isAdmin(claims);
  }

  if (pathname.startsWith('/api/check-in/admin/')) return isAdmin(claims);
  if (pathname.startsWith('/api/check-in/teacher/')) return isTeacher(claims);
  if (pathname.startsWith('/api/check-in/family/')) return isFamily(claims);
  if (pathname.startsWith('/api/check-in/notifications/')) return isAdmin(claims);
  // Legacy kiosk APIs - no longer public (removed from PUBLIC_ROUTES), gated to
  // the shared kiosk credential (admin inherits kiosk). One prefix covers both
  // /api/check-in/families/{id} and /api/check-in/families/{id}/check-in; two
  // exact matches cover lookup + guests. `families/` does NOT start with
  // `family/`, so the isFamily rule above is unaffected.
  if (pathname.startsWith('/api/check-in/families/')) return isKiosk(claims) || isAdmin(claims);
  if (pathname === '/api/check-in/lookup') return isKiosk(claims) || isAdmin(claims);
  if (pathname === '/api/check-in/guests') return isKiosk(claims) || isAdmin(claims);
  // Authenticated Setu kiosk endpoints (door tablet) - NOT public. Covers the
  // lookup (GET .../setu/lookup) + submit (POST .../setu/check-in) paths and any
  // future Setu kiosk path in one prefix. The dedicated least-privilege `kiosk`
  // role authorizes them; admin inherits kiosk. Must have an explicit rule (this
  // prefix matches none of the four /api/check-in/* prefixes above - none start
  // with `setu` - and would otherwise fall through to the final default-deny).
  if (pathname.startsWith('/api/check-in/setu/')) return isKiosk(claims) || isAdmin(claims);

  // Coordinator: the Programs + Level management PAGES. Explicit narrow clauses
  // ABOVE the admin page catch-all, never by loosening it.
  if (pathname === '/admin/programs' || pathname.startsWith('/admin/programs/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (pathname === '/admin/levels' || pathname.startsWith('/admin/levels/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  // New /admin/* surface (Setu-themed). Pages and APIs both admin-only.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return isAdmin(claims);
  // Teacher assignment — admin + coordinator. Welcome-team was removed
  // 2026-08-03: the role is scoped to the roster and the visitors board and
  // nothing else (see the /welcome clauses below for the full rationale).
  // Must be checked BEFORE the generic admin-only /api/admin/ rule.
  if (
    pathname === '/api/admin/teacher-assignments' ||
    pathname.startsWith('/api/admin/teacher-assignments/')
  ) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  // Managed class calendar is published by admin only (welcome-team removed
  // 2026-08-03). Must be checked before the generic admin-only /api/admin/ rule.
  if (pathname === '/api/admin/calendar' || pathname.startsWith('/api/admin/calendar/')) {
    return isAdmin(claims);
  }
  // Teacher name-search — admin + coordinator, the roles that assign teachers.
  // Distinct prefix from /api/admin/teacher-assignments (handled above). Must be
  // checked before the generic admin-only /api/admin/ rule.
  if (pathname === '/api/admin/teachers/search' || pathname.startsWith('/api/admin/teachers/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  // Per-level teacher add/remove — admin + coordinator. Only the `/teachers`
  // sub-path opens up; level CRUD stays admin-only via the catch-all.
  if (/^\/api\/admin\/levels\/[^/]+\/teachers\/?$/.test(pathname)) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  // Coordinator API surface: programs, offerings (pricing lives in
  // offering.pricingTiers) and level CRUD.
  //
  // PLACEMENT IS LOAD-BEARING. The broad /api/admin/levels clause MUST stay
  // below the /api/admin/levels/{id}/teachers regex directly above.
  // canAccessRoute returns at the FIRST match, so hoisting it would swallow the
  // teachers sub-path and silently revoke welcome-team's per-level teacher
  // management - a capability that works in production today. A regression test
  // pins it.
  if (pathname === '/api/admin/programs' || pathname.startsWith('/api/admin/programs/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (pathname === '/api/admin/offerings' || pathname.startsWith('/api/admin/offerings/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (pathname === '/api/admin/levels' || pathname.startsWith('/api/admin/levels/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  // Never loosen this catch-all: api/admin/welcome-team has NO in-handler role
  // check, so this prefix is the only thing stopping a non-admin from granting
  // welcome-team. Every exception above is an explicit narrow clause.
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

  // Adult Study Class selection screen — a top-level route (NOT under /family, to
  // avoid the gate redirect loop) that the /family gate sends a paid Bala Vihar
  // manager to. Granted to any signed-in Setu family, exactly like the two
  // screens above: only a manager can actually commit a selection, and the page
  // itself sends a non-manager on to /family. Denying a member HERE would 302
  // them at the middleware instead, and an authorization denial is what produces
  // the ERR_TOO_MANY_REDIRECTS bounce this codebase already has open.
  if (pathname === '/adult-class' || pathname.startsWith('/adult-class/')) {
    return isSetuFamily(claims);
  }

  // Donation success — top-level, OUTSIDE the /family layout, and that placement
  // is the point: a family returning from Stripe must land on their receipt, not
  // be redirected away by the adult-class gate. Exempting a path from INSIDE the
  // layout is not an option (a server component has no pathname, and the header
  // workaround is what caused the /complete-profile redirect loop), so the page
  // moved out instead. Any signed-in Setu family; the page binds the donation to
  // the session's own fid.
  if (pathname === '/donate' || pathname.startsWith('/donate/')) {
    return isSetuFamily(claims);
  }

  // Welcome-team + coordinator: roster browse + read-only family detail.
  // `/welcome` root is included because it redirects to /welcome/roster -
  // denying it would block the redirect itself. `/welcome/family/*` is included
  // because EVERY roster row links to it, so without it the screen is a dead end
  // that 302s on click. Spec 3.1 excludes family EDIT from coordinator, not
  // family READ, and the roster already exposes the same PII.
  if (
    pathname === '/welcome' ||
    pathname === '/welcome/roster' ||
    pathname.startsWith('/welcome/roster/') ||
    pathname === '/welcome/family' ||
    pathname.startsWith('/welcome/family/')
  ) {
    return isWelcomeTeam(claims) || isCoordinator(claims);
  }
  // Welcome-team: the Sunday visitors board. Welcome-team only, NOT coordinator
  // (whose grant is Programs + Levels + Roster).
  if (pathname === '/welcome/visitors' || pathname.startsWith('/welcome/visitors/')) {
    return isWelcomeTeam(claims);
  }
  // Everything else under /welcome — levels, seva, prasad, reports — is
  // ADMIN-ONLY as of 2026-08-03. The welcome-team role is deliberately scoped to
  // the two screens above ("they need to be able to update roster and visitors,
  // no other access needed"). Admins are unaffected: they reach these pages
  // through the admin nav and inherit every capability the role used to hold.
  // A new /welcome/* page therefore defaults to admin-only and must be granted
  // explicitly above, which is the safe direction for this catch-all.
  if (pathname === '/welcome' || pathname.startsWith('/welcome/')) {
    return isAdmin(claims);
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

  // Setu API — adult-class selection: manager-only, and narrower than the
  // /api/setu/ catch-all below, which also grants welcome-team and admin. Those
  // roles have no `fid` of their own, so the handler (which binds fid from the
  // session) could only ever 400 for them — better to deny at the edge than to
  // let a staff session reach a family-scoped write at all.
  // EXACT match, not the `|| startsWith(x + '/')` shape its siblings use: no
  // sub-path handler exists, and this file's own note above the welcome-donations
  // gap says authorizing paths without handlers "silently passes requests that
  // should get 404/501". Widen it when a sub-path actually ships.
  if (pathname === '/api/setu/adult-class') {
    return isSetuManager(claims);
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
  // Coordinator included: this is the ONLY data endpoint behind /welcome/roster,
  // the one screen the role is granted, so omitting it leaves the page empty.
  if (pathname === '/api/welcome/roster' || pathname.startsWith('/api/welcome/roster/')) {
    return isWelcomeTeam(claims) || isCoordinator(claims);
  }

  // Prasad day-of lists (read-only) — ADMIN-ONLY as of 2026-08-03, matching the
  // /welcome/prasad page above.
  if (pathname === '/api/welcome/prasad' || pathname.startsWith('/api/welcome/prasad/')) {
    return isAdmin(claims);
  }

  // Enrollment writes incl. the payment OVERRIDE — admin-only as of 2026-08-03.
  // This one carries money: `/api/welcome/enrollments/{eid}/override` rewrites
  // what a family owes, which is the clearest case in this file for keeping the
  // narrowed grant.
  if (
    pathname.startsWith('/api/welcome/enrollments/') ||
    pathname === '/api/welcome/enrollments'
  ) {
    return isAdmin(claims);
  }

  // Seva management — opportunities, signup rosters, confirmations: admin-only
  // as of 2026-08-03, matching the /welcome/seva pages above.
  if (pathname === '/api/welcome/seva' || pathname.startsWith('/api/welcome/seva/')) {
    return isAdmin(claims);
  }

  // Reports hub (enrollment + attendance) — admin-only as of 2026-08-03. The
  // donations report was removed earlier (no collective financial info here).
  if (pathname === '/api/welcome/reports' || pathname.startsWith('/api/welcome/reports/')) {
    return isAdmin(claims);
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

  // Setu API — remaining paths (invite/send, register, etc.): manager + admin.
  // family-member is NOT included here; manager-level is the safe default for
  // unknown setu paths. Welcome-team was removed 2026-08-03 with the rest of the
  // narrowing: no /welcome screen calls an unlisted /api/setu/* path (the three
  // it does use — family/search, members/{mid}/profile, programs — each have an
  // explicit clause above), and the paths this catch-all actually covers are
  // family-scoped writes like invite/send that the front desk has no UI for.
  if (pathname.startsWith('/api/setu/')) {
    return isSetuManager(claims) || isAdmin(claims);
  }

  // Monthly pledge (P5). FAMILY-MANAGER ONLY - deliberately narrower than every
  // other family API, and the reason these routes live outside `/api/setu/*`:
  // that prefix's catch-all above grants welcome-team and admin, and a route
  // that creates a recurring debit against a family must never inherit
  // authorization from a prefix. A volunteer at the front desk has no business
  // starting a monthly gift on a family's behalf, and neither does an admin.
  //
  // The admin cancel route is a separate path (`/api/admin/pledges/...`) and is
  // covered by the admin rules above, not by this one.
  if (pathname === '/api/pledges' || pathname.startsWith('/api/pledges/')) {
    return isSetuManager(claims);
  }

  return false;
}
