import { describe, it, expect } from 'vitest';
import { isPublicRoute } from '@cmt/shared-domain';
// The repo-root vercel.ts, four levels up. Imported rather than re-listed so
// this cannot go stale the moment someone adds a cron.
import { config as vercelConfig } from '../../../../vercel';

/**
 * Every cron declared in vercel.ts must be reachable by Vercel Cron.
 *
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}`, which the Firebase
 * session/ID-token verifier cannot decode - so without an entry in
 * PUBLIC_ROUTES the middleware 401s the request before the handler's own
 * CRON_SECRET check ever runs, and the job silently never fires. That invariant
 * was previously a comment in public-routes.ts. A comment does not fail a build.
 *
 * These routes are public at the MIDDLEWARE layer only. Each handler
 * self-authenticates with a timing-safe CRON_SECRET comparison, which the second
 * test below is the standing reminder of.
 */
describe('cron routes', () => {
  const cronPaths = (vercelConfig.crons ?? []).map((c) => c.path);

  it('declares at least the crons this repo ships', () => {
    // Guards the guard: if the import ever resolved to an empty config, every
    // assertion below would pass vacuously.
    expect(cronPaths.length).toBeGreaterThanOrEqual(4);
    expect(cronPaths).toContain('/api/cron/reconcile-pledges');
  });

  it.each((vercelConfig.crons ?? []).map((c) => c.path))(
    '%s is allowlisted in PUBLIC_ROUTES, or it silently 401s on every scheduled run',
    (path) => {
      expect(isPublicRoute(path)).toBe(true);
    },
  );
});
