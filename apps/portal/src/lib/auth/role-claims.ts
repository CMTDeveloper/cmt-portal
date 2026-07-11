/**
 * Pure helpers for safely adding/removing capability roles (admin,
 * welcome-team, kiosk) on Firebase auth customClaims without clobbering the
 * primary role.
 *
 * Multi-role design: a user always has one primary `role` (drives dashboard
 * + UI surface) and an optional `extraRoles` array of additional
 * capabilities. E.g. a family-manager who is also an admin:
 *   { role: 'family-manager', extraRoles: ['admin'], fid, mid, email }
 *
 * Family roles (family-manager / family-member / family) always win the
 * primary slot because /family is the user-facing surface. Admin and
 * welcome-team get pushed to extras when stacked on a family.
 */

export type Capability = 'admin' | 'welcome-team' | 'kiosk';
const FAMILY_ROLES = new Set(['family-manager', 'family-member', 'family']);

export interface ClaimsShape {
  role?: string;
  extraRoles?: string[];
  email?: string;
  [k: string]: unknown;
}

export function hasCapability(claims: ClaimsShape | null | undefined, cap: Capability): boolean {
  if (!claims) return false;
  if (claims.role === cap) return true;
  if (Array.isArray(claims.extraRoles) && claims.extraRoles.includes(cap)) return true;
  return false;
}

export function addCapability(
  existing: ClaimsShape | null | undefined,
  cap: Capability,
  email: string | undefined,
): ClaimsShape {
  const e: ClaimsShape = existing ? { ...existing } : {};
  const extras = new Set<string>(Array.isArray(e.extraRoles) ? e.extraRoles : []);
  const primary = typeof e.role === 'string' ? e.role : undefined;

  // Idempotent: already has cap → no-op, but refresh email if provided.
  if (primary === cap || extras.has(cap)) {
    return cleanClaims({ ...e, ...(email ? { email } : {}) });
  }

  // No primary role: cap becomes primary.
  if (!primary) {
    extras.delete(cap);
    return cleanClaims({ ...e, role: cap, extraRoles: [...extras], ...(email ? { email } : {}) });
  }

  // Family primary: preserve, add cap to extras.
  if (FAMILY_ROLES.has(primary)) {
    extras.add(cap);
    return cleanClaims({ ...e, role: primary, extraRoles: [...extras], ...(email ? { email } : {}) });
  }

  // Non-family primary stacking. Admin is highest tier — promote it.
  if (cap === 'admin' && primary === 'welcome-team') {
    extras.add('welcome-team');
    extras.delete('admin');
    return cleanClaims({ ...e, role: 'admin', extraRoles: [...extras], ...(email ? { email } : {}) });
  }

  // Default: add to extras while keeping primary.
  extras.add(cap);
  return cleanClaims({ ...e, extraRoles: [...extras], ...(email ? { email } : {}) });
}

export function removeCapability(
  existing: ClaimsShape | null | undefined,
  cap: Capability,
): ClaimsShape {
  const e: ClaimsShape = existing ? { ...existing } : {};
  const extras = (Array.isArray(e.extraRoles) ? e.extraRoles : []).filter((r) => r !== cap);
  const primary = typeof e.role === 'string' ? e.role : undefined;

  if (primary === cap) {
    if (extras.length > 0) {
      const promoted = extras[0]!;
      return cleanClaims({ ...e, role: promoted, extraRoles: extras.slice(1) });
    }
    // No fallback role — drop primary + extras entirely.
    const rest: ClaimsShape = { ...e };
    delete rest.role;
    delete rest.extraRoles;
    return rest;
  }

  return cleanClaims({ ...e, extraRoles: extras });
}

function cleanClaims(c: ClaimsShape): ClaimsShape {
  const out: ClaimsShape = { ...c };
  if (Array.isArray(out.extraRoles) && out.extraRoles.length === 0) {
    delete out.extraRoles;
  }
  return out;
}
