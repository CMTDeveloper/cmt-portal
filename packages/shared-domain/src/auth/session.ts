import type { Role } from './role';

export interface SessionClaims {
  uid: string;
  role: Role;
  familyId?: string;
  email?: string;
  phone?: string;
  iat?: number;
  exp?: number;
}
