// Canonical portal origin for building absolute, security-sensitive URLs
// (magic-link sign-in, invite/email links). NEVER derive these from a
// request's Host / x-forwarded-host alone: an attacker who can get a request
// through with a forged host for a known user's email would have the victim
// emailed a REAL one-time token pointing at the attacker's domain
// (host-header / reset-link poisoning). So prefer a configured canonical base
// and only accept a request host when it matches a strict allowlist.

const PROD_FALLBACK = 'https://cmt-setu.vercel.app';
// Vercel preview/prod domains for this project.
const VERCEL_HOST = /^cmt-(setu|portal)[a-z0-9-]*\.vercel\.app$/;

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.startsWith('localhost') || h.startsWith('127.0.0.1')) return true;
  return VERCEL_HOST.test(h);
}

/**
 * Returns the trusted origin (no trailing slash) to build absolute auth URLs.
 * Order: configured NEXT_PUBLIC_PORTAL_BASE_URL → an allowlisted request host
 * → the hardcoded prod fallback. The result can never be an attacker-chosen
 * host.
 */
export function portalBaseUrl(req?: Request): string {
  const configured = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // misconfigured env — fall through to host/fallback
    }
  }

  if (req) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (host && isAllowedHost(host)) {
      const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
      return `${proto}://${host}`;
    }
  }

  return PROD_FALLBACK;
}
