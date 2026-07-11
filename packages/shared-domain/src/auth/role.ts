export const ROLES = ['admin', 'teacher', 'family', 'family-manager', 'family-member', 'welcome-team', 'kiosk'] as const;
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
  return hasRole(claims, 'welcome-team') || hasRole(claims, 'admin');
}

// Dedicated least-privilege role for the shared kiosk/tablet account used at
// the door to check families in. Admins inherit it (same pattern as isTeacher/
// isWelcomeTeam) so a signed-in admin can operate the kiosk without a second
// grant. Nothing else inherits kiosk - it is intentionally narrow.
export function isKiosk(claims: WithRole): boolean {
  return hasRole(claims, 'kiosk') || hasRole(claims, 'admin');
}
