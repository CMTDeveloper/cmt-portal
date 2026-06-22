import { headers } from 'next/headers';

/**
 * Best-effort read of the current request pathname inside a Server Component,
 * used only by the profile-completion gate in `app/family/layout.tsx` to exempt
 * the `/family/complete-profile` route from its own redirect (no infinite loop).
 *
 * Next.js 16 does not expose the request pathname to layouts/pages directly, so
 * the repo's middleware forwards it on the `x-portal-pathname` request header
 * (set-or-deleted from the verified request the same way as the other
 * `x-portal-*` claim headers). We read that here.
 *
 * IMPORTANT — fail-open: if the header is absent (e.g. middleware hasn't set it
 * yet, or a non-middleware code path), this returns `null`. The gate treats a
 * `null` pathname as "do not redirect", so a missing header can never lock a
 * family out of the dashboard or cause a redirect loop. The gate only fires
 * once it can positively confirm the path is NOT the completion route.
 */
export async function getRequestPathname(): Promise<string | null> {
  try {
    const h = await headers();
    // Primary: the middleware-forwarded header. Fallbacks cover any platform
    // that surfaces the path under a different conventional key.
    const value =
      h.get('x-portal-pathname') ??
      h.get('x-pathname') ??
      h.get('x-invoke-path') ??
      null;
    if (!value) return null;
    // Header may carry a full URL or a path; normalize to the pathname only.
    if (value.startsWith('/')) {
      // Strip any query string defensively.
      const q = value.indexOf('?');
      return q === -1 ? value : value.slice(0, q);
    }
    try {
      return new URL(value).pathname;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
