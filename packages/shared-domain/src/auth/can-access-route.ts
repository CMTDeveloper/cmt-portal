import type { SessionClaims } from './session';
import { isPublicRoute } from './public-routes';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isWelcomeTeam } from './role';

export function canAccessRoute(claims: SessionClaims, pathname: string): boolean {
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

  // Setu family portal
  if (pathname === '/family' || pathname.startsWith('/family/')) {
    return isSetuFamily(claims);
  }
  if (pathname.startsWith('/api/setu/family') || pathname.startsWith('/api/setu/members')) {
    return isSetuFamily(claims);
  }

  // Welcome-team portal
  if (pathname === '/welcome' || pathname.startsWith('/welcome/')) {
    return isWelcomeTeam(claims);
  }
  if (pathname.startsWith('/api/setu/')) {
    return isSetuFamily(claims) || isWelcomeTeam(claims) || isAdmin(claims);
  }

  return false;
}
