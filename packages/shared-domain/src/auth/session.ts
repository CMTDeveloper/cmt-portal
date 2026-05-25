import type { Role } from './role';

export interface SessionClaims {
  uid: string;
  /** Primary role — drives dashboard redirect and the visible UI surface. */
  role: Role;
  /**
   * Additional capabilities a user has on top of their primary role.
   * E.g. a family-manager who is also an admin: role='family-manager',
   * extraRoles=['admin']. Checked by isAdmin/isWelcomeTeam alongside role.
   */
  extraRoles?: Role[];
  familyId?: string;
  /** Setu family id — set for family-manager and family-member roles */
  fid?: string;
  /** Setu member id — set for family-manager and family-member roles */
  mid?: string;
  email?: string;
  phone?: string;
  iat?: number;
  exp?: number;
}
