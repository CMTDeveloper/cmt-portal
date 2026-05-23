export const ROLES = ['admin', 'teacher', 'family', 'family-manager', 'family-member', 'welcome-team'] as const;
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

export function isSetuFamily(claims: WithRole): boolean {
  return claims.role === 'family-manager' || claims.role === 'family-member';
}

export function isSetuManager(claims: WithRole): boolean {
  return claims.role === 'family-manager';
}

export function isWelcomeTeam(claims: WithRole): boolean {
  return claims.role === 'welcome-team';
}
