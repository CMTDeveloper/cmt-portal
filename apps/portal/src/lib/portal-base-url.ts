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

/**
 * CMT's own domain, and any host under it.
 *
 * ── Why this had to be added (Vaibhav, 2026-07-30) ──────────────────────────
 * *"I created the subdomain setu-preview.chinmayatoronto.org but on Stripe, it
 * was pointing to vercel Url for cancel... this will be an issue for prod as
 * well since we will be using custom domain."*
 *
 * With only the Vercel pattern here, a request arriving on a custom domain
 * matched nothing and fell through to PROD_FALLBACK. That is worse than losing
 * the branding: a family who backed out of Stripe on the PREVIEW deployment was
 * handed a return url pointing at PRODUCTION.
 *
 * ── Why a pattern rather than two hostnames ─────────────────────────────────
 * Hardcoding `setu.` and `setu-preview.` would break again the moment CMT picks
 * a different name - which is exactly the failure being fixed. Every host under
 * chinmayatoronto.org is under CMT's own DNS control, so the trust boundary is
 * the same one that already governs the email addresses these links are sent to.
 *
 * ⚠️ The residual risk is a dangling subdomain: if a CNAME under
 * chinmayatoronto.org is ever left pointing at a service someone else can claim,
 * that host would be trusted here and could harvest magic-link and invite
 * tokens. It is bounded by CMT holding the zone; if the zone ever gains
 * third-party-hosted subdomains, narrow this to an explicit list.
 *
 * The `([a-z0-9-]+\.)*` prefix is anchored on both ends, so `evil-
 * chinmayatoronto.org`, `chinmayatoronto.org.evil.com` and `chinmayatoronto.com`
 * all fail - only true subdomains match.
 */
const CMT_HOST = /^([a-z0-9-]+\.)*chinmayatoronto\.org$/;

/** The hostname alone, with any `:port` removed, lowercased. */
function hostnameOf(host: string): string {
  const h = host.toLowerCase().trim();
  const i = h.lastIndexOf(':');
  return i > -1 && /^\d+$/.test(h.slice(i + 1)) ? h.slice(0, i) : h;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Is this request host one we are willing to build an absolute, security-
 * sensitive URL from?
 *
 * Exported because the donation checkout route needs the SAME answer. It used to
 * carry its own copy of this list, so widening one and not the other would leave
 * the one-time donation flow rejecting a domain the pledge flow accepted.
 */
export function isTrustedPortalHost(host: string): boolean {
  const h = hostnameOf(host);
  // Exact, not startsWith: `localhost.evil.com` passed the old prefix check and
  // was then handed an http:// origin.
  if (isLoopback(h)) return true;
  return VERCEL_HOST.test(h) || CMT_HOST.test(h);
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
    if (host && isTrustedPortalHost(host)) {
      const proto = isLoopback(hostnameOf(host)) ? 'http' : 'https';
      return `${proto}://${host}`;
    }
  }

  return PROD_FALLBACK;
}
