export const PUBLIC_ROUTES = [
  // Landing
  '/',

  // Legacy login surface (Slice B family check-in auth). Kept until the new
  // Setu auth handles all three roles and the /check-in/* tree is retired.
  '/login',
  '/login/admin',
  '/login/teacher',
  '/login/family',

  // 2026 redesign — Setu family flow entry points (public).
  // /family and /family/ are auth-gated — intentionally NOT listed here.
  '/sign-in',
  '/register',
  '/register/family',
  '/invite/:token',

  // Setu OTP auth APIs (public — unauthenticated users call these to sign in)
  '/api/setu/auth/send-code',
  '/api/setu/auth/verify-code',
  '/api/setu/auth/signout',
  // Magic-link redemption (the token itself is the credential — no session needed)
  '/api/setu/auth/magic/:token',

  // Setu registration APIs (public — unauthenticated callers begin the
  // sign-up flow here; these routes enforce their own rate limiting and
  // input validation, so middleware must not 401 them before they're reached)
  '/api/setu/family-lookup',
  '/api/setu/register',

  // Kiosk (public) — feature-flagged in the app layer
  '/check-in',
  '/check-in/guest',
  '/check-in/lookup',

  // Public auth APIs (legacy Slice B)
  '/api/auth/admin/signin',
  '/api/auth/teacher/signin',
  '/api/auth/family/send-code',
  '/api/auth/family/verify-code',
  '/api/auth/signout',

  // Public kiosk APIs
  '/api/check-in/families/:familyId',
  '/api/check-in/families/:familyId/check-in',
  '/api/check-in/lookup',
  '/api/check-in/guests',
] as const;

export function matchRoute(pattern: string, pathname: string): boolean {
  if (pattern.endsWith('/') && pattern.length > 1) {
    return pathname.startsWith(pattern);
  }

  if (pattern.includes(':')) {
    const patternSegments = pattern.split('/');
    const pathSegments = pathname.split('/');
    if (patternSegments.length !== pathSegments.length) return false;
    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i];
      const s = pathSegments[i];
      if (p === undefined || s === undefined) return false;
      if (p.startsWith(':')) continue;
      if (p !== s) return false;
    }
    return true;
  }

  return pattern === pathname;
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((p) => matchRoute(p, pathname));
}
