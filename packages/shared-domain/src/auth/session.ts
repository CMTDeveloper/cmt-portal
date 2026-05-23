import type { Role } from './role';

export interface SessionClaims {
  uid: string;
  role: Role;
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
