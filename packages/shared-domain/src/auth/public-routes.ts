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
  // Join-request review PAGE — the emailed "Review request" link target. Public
  // like /invite/:token: a static shell whose client GETs the request (the
  // manager-only /api/setu/join-request/:token API) and, on 401/403, redirects
  // to /sign-in?from=/join-request/:token. WITHOUT this entry the page is
  // auth-gated by canAccessRoute (which has no page rule for it), so even a
  // signed-in manager is denied 'unauthorized' and bounced to the LEGACY /login.
  '/join-request/:token',

  // Setu OTP auth APIs (public — unauthenticated users call these to sign in)
  '/api/setu/auth/send-code',
  '/api/setu/auth/verify-code',
  '/api/setu/auth/password-sign-in',
  '/api/setu/auth/signout',
  // Magic-link redemption (the token itself is the credential — no session needed)
  '/api/setu/auth/magic/:token',

  // Setu registration APIs (public — unauthenticated callers begin the
  // sign-up flow here; these routes enforce their own rate limiting and
  // input validation, so middleware must not 401 them before they're reached)
  '/api/setu/family-lookup',
  '/api/setu/register',
  // The register wizard's "How can you help?" picker fetches the admin-managed
  // volunteering-skill OPTIONS here, but the registering user has no session yet.
  // The options are org-wide, non-sensitive config (a list of volunteer
  // categories), and the GET handler is read-only, so it's public — without this
  // the picker 401s pre-auth and shows "No volunteering options have been set up
  // yet." (Also read by the authed member add/edit forms; still works for them.)
  '/api/setu/volunteering-skills',
  // The register wizard's centre picker fetches the admin-managed location
  // OPTIONS here, but the registering user has no session yet. The centre list
  // is org-wide, non-sensitive config, and the GET handler is read-only, so it's
  // public - without this the picker 401s pre-auth. (Also read by authed member
  // forms; still works for them.) Writes go through /api/admin/locations (admin).
  '/api/setu/locations',

  // Join-request: the "request to join your family manager" send endpoint is
  // public — the requester is mid-registration with no session yet. The rest of
  // /api/setu/join-request/* (list, [token], approve, decline) is manager-only
  // via canAccessRoute. The handler is IP rate-limited + anti-enumeration
  // (always {ok:true}), like family-lookup, so middleware must not 401 it.
  '/api/setu/join-request/send',

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

  // Vercel Cron endpoints. Listed here BECAUSE their handlers self-verify
  // CRON_SECRET via a timing-safe Bearer check (verifyCronAuth) — Vercel Cron
  // sends `Authorization: Bearer ${CRON_SECRET}`, which the Firebase
  // session/ID-token verifier can't decode. Without this allowlist the
  // middleware 401s the cron request before its own CRON_SECRET enforcement
  // runs, so the scheduled jobs never fire. These are public at the middleware
  // layer but self-authenticating in the handler (same pattern as
  // webhooks/register). EVERY path declared as a cron in vercel.ts MUST be
  // listed here — a scheduled job whose route is missing here silently 401s.
  '/api/cron/reset-cache',
  '/api/cron/send-weekly-payment-reminders',
  '/api/cron/send-prasad-reminders',

  // NOTE: /api/webhooks/stripe and /api/cron/archive-pledges remain
  // intentionally absent until their Stripe-signature-verifying and
  // CRON_SECRET-verifying handlers ship in slice 3c/3d. Adding a route here
  // without a self-authenticating handler would expose an unauthenticated
  // endpoint with no enforcement.
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
