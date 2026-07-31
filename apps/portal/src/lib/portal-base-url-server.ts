import 'server-only';
import { headers } from 'next/headers';
import { portalBaseUrl, trustedOriginFromHost } from './portal-base-url';

/**
 * `portalBaseUrl` for code that has no `Request` in hand - i.e. a server
 * component render.
 *
 * ── Why this exists (found from a real email, 2026-07-31) ───────────────────
 * The "your Bala Vihar enrollment is not yet confirmed" letter carries a
 * "Confirm Your Enrollment" button, built from `portalBaseUrl`. Its three
 * triggers all fire from PAGE renders - `/family`, `/family/enroll/[programKey]`
 * and `/family/donate/cancel` - and a server component has no Request, so every
 * one of them called `portalBaseUrl(undefined)`. That skips the request-host
 * step entirely and lands on the configured env or, failing that, PROD_FALLBACK.
 *
 * On Preview, where `NEXT_PUBLIC_PORTAL_BASE_URL` is deliberately unset, the
 * button therefore pointed at PRODUCTION - the same cross-environment leak
 * Vaibhav reported for the Stripe cancel url on 2026-07-30, surviving in the
 * email because the fix only reached paths that thread a Request.
 *
 * `next/headers` is the server-component equivalent of those request headers, so
 * this recovers the host and applies the identical allowlist. It stays in its
 * OWN module because `lib/portal-base-url.ts` is imported by plain unit tests
 * that run outside any Next request scope; importing `next/headers` there would
 * drag that dependency into all of them.
 *
 * NEVER THROWS. `headers()` throws outside a request scope - the payment
 * reminder cron is exactly that case - so the fallback is the ordinary
 * env-or-PROD_FALLBACK chain, which is correct there: a cron has no host to
 * inherit and production's env is set.
 */
export async function portalBaseUrlHere(): Promise<string> {
  try {
    const h = await headers();
    const fromHost = trustedOriginFromHost(h.get('x-forwarded-host') ?? h.get('host'));
    // A CONFIGURED base still wins, exactly as in portalBaseUrl: production
    // should emit one canonical host regardless of which alias was hit.
    const configured = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    if (configured) {
      try {
        return new URL(configured).origin;
      } catch {
        // misconfigured env - prefer the real host below
      }
    }
    if (fromHost) return fromHost;
  } catch {
    // no request scope (cron, build-time evaluation) - fall through
  }
  return portalBaseUrl();
}
