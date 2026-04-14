export const ROLES = ['admin', 'teacher', 'family'] as const;
export type Role = (typeof ROLES)[number];

export interface WithRole {
  role?: Role;
}

export function isAdmin(claims: WithRole): boolean {
  return claims.role === 'admin';
}

export function isTeacher(claims: WithRole): boolean {
  return claims.role === 'teacher' || claims.role === 'admin';
}

export function isFamily(claims: WithRole): boolean {
  return claims.role === 'family';
}
