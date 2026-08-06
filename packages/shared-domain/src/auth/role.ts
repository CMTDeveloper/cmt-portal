export const ROLES = ['admin', 'teacher', 'family', 'family-manager', 'family-member', 'welcome-team', 'kiosk', 'coordinator'] as const;
export type Role = (typeof ROLES)[number];

export interface WithRole {
  role?: Role;
  /** Additional capabilities on top of primary `role`. See SessionClaims. */
  extraRoles?: Role[];
}

// Return ALL roles a user has — primary + extras. Used by capability checks.
function rolesOf(claims: WithRole): Role[] {
  const out: Role[] = [];
  if (claims.role) out.push(claims.role);
  if (Array.isArray(claims.extraRoles)) {
    for (const r of claims.extraRoles) {
      if (!out.includes(r)) out.push(r);
    }
  }
  return out;
}

export function hasRole(claims: WithRole, role: Role): boolean {
  return rolesOf(claims).includes(role);
}

export function isAdmin(claims: WithRole): boolean {
  return hasRole(claims, 'admin');
}

// Teachers + admins can do teacher things. Multi-role: an admin who is ALSO
// a teacher (role='admin', extraRoles=['teacher']) still passes.
export function isTeacher(claims: WithRole): boolean {
  return hasRole(claims, 'teacher') || hasRole(claims, 'admin');
}

export function isFamily(claims: WithRole): boolean {
  return hasRole(claims, 'family');
}

export function isSetuFamily(claims: WithRole): boolean {
  return hasRole(claims, 'family-manager') || hasRole(claims, 'family-member');
}

export function isSetuManager(claims: WithRole): boolean {
  return hasRole(claims, 'family-manager');
}

export function isWelcomeTeam(claims: WithRole): boolean {
  // Admins implicitly get welcome-team capability — they can do anything
  // a welcome-team volunteer can. This avoids needing to grant both.
  //
  // Coordinators do too, as of 2026-08-05. Vaibhav: *"Coordinator gets
  // everything Welcome team has and plus"* — so the ladder is
  // welcome-team < coordinator < admin, and this single line is what makes it
  // true everywhere rather than one clause at a time. Adding `|| isCoordinator`
  // to individual routes was the alternative and it is the worse one: it makes
  // every NEW welcome-team route a decision someone has to remember to repeat.
  //
  // What this does NOT grant is as important: the `/welcome/*` catch-all in
  // canAccessRoute is `isAdmin`, so reports/seva/prasad/levels stay closed to
  // both roles, and the enrollment payment override is admin-only at all three
  // gates. The full allow/deny table lives in
  // __tests__/can-access-route.test.ts.
  return hasRole(claims, 'welcome-team') || hasRole(claims, 'coordinator') || hasRole(claims, 'admin');
}

// Dedicated least-privilege role for the shared kiosk/tablet account used at
// the door to check families in. Admins inherit it (same pattern as isTeacher/
// isWelcomeTeam) so a signed-in admin can operate the kiosk without a second
// grant. Nothing else inherits kiosk - it is intentionally narrow.
export function isKiosk(claims: WithRole): boolean {
  return hasRole(claims, 'kiosk') || hasRole(claims, 'admin');
}

// Programs + Levels + Offerings + teacher assignment.
//
// This used to read "Deliberately inherits NOTHING from welcome-team ... the
// two are siblings with disjoint grants (spec 3.1)". That is no longer true:
// as of 2026-08-05 coordinator sits ABOVE welcome-team and inherits all of it
// (see isWelcomeTeam above), which was a deliberate reversal of spec 3.1 by
// the owner, not drift.
//
// So `isCoordinator` is now the narrow question — "does this caller hold the
// Programs/Levels grant specifically?" — and it is NOT the way to ask whether
// someone can reach a welcome-team surface. Use isWelcomeTeam for that; it
// already returns true for coordinator. A route that asks
// `isWelcomeTeam(c) || isCoordinator(c)` is redundant, not safer.
//
// Admins inherit it, same pattern as isTeacher/isWelcomeTeam.
export function isCoordinator(claims: WithRole): boolean {
  return hasRole(claims, 'coordinator') || hasRole(claims, 'admin');
}
