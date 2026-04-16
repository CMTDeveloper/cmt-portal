export const PUBLIC_ROUTES = [
  // Slice A landing + stubs
  '/',
  '/events',

  // Login surface
  '/login',
  '/login/admin',
  '/login/teacher',
  '/login/family',

  // Kiosk (public) — feature-flagged in the app layer
  '/check-in',
  '/check-in/guest',
  '/check-in/lookup',

  // Public auth APIs
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

  // Event registration (public, no auth — feature-flagged in the app layer)
  '/events/register',
  '/events/register/payment',
  '/events/register/success',
  '/events/register/cancel',

  // Public event APIs
  '/api/events/check-bv-status',
  '/api/events/register',
  '/api/events/lookup',
  '/api/events/create-checkout',
  '/api/events/update-reference',
  '/api/events/update-payment-status',
  '/api/events/webhooks/payment-status',
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
