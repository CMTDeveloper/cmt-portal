/**
 * E2E: Welcome-team family search
 *
 * Seeds two test families with distinct names + contacts, then exercises:
 *   GET /api/setu/family/search?q=<name-prefix>
 *   GET /api/setu/family/search?q=<email>
 *
 * Requires a welcome-team session header (x-portal-role: welcome-team).
 *
 * Cleanup: all test docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const hasUatCreds =
  !!process.env['PORTAL_FIREBASE_PROJECT_ID'] &&
  !!process.env['PORTAL_FIREBASE_CLIENT_EMAIL'] &&
  !!process.env['PORTAL_FIREBASE_PRIVATE_KEY'];

vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: () => ({
    sendEmail: vi.fn().mockResolvedValue(undefined),
    sendSMS: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
  headers: vi.fn(() => new Headers()),
}));

describe.skipIf(!hasUatCreds)(
  'E2E: Welcome-team search — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    // Both families share this unique prefix so the search query only hits test data
    const SEARCH_PREFIX = `e2esrch${RUN_ID.toLowerCase()}`;
    // Use timestamp digits directly so phones are numeric and unique per run
    const TS = Date.now().toString();

    const FAMILY_A_NAME = `${SEARCH_PREFIX} alpha family`;
    const FAMILY_A_EMAIL = `${SEARCH_PREFIX}.alpha@test.cmt.invalid`;
    const FAMILY_A_PHONE = `416${TS.slice(-7)}`;

    const FAMILY_B_NAME = `${SEARCH_PREFIX} beta family`;
    const FAMILY_B_EMAIL = `${SEARCH_PREFIX}.beta@test.cmt.invalid`;
    const FAMILY_B_PHONE = `647${TS.slice(-7)}`;

    let fidA: string;
    let fidB: string;

    beforeAll(async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const [resultA, resultB] = await Promise.all([
        createTestFamily({ name: FAMILY_A_NAME, email: FAMILY_A_EMAIL, phone: FAMILY_A_PHONE }),
        createTestFamily({ name: FAMILY_B_NAME, email: FAMILY_B_EMAIL, phone: FAMILY_B_PHONE }),
      ]);
      fidA = resultA.fid;
      fidB = resultB.fid;
    });

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e welcome-search] cleanup error (non-fatal):', err);
      }
    });

    it('GET search?q=<fidA> returns family A by direct fid lookup', async () => {
      // searchFamilies does a direct doc lookup when query looks like a fid,
      // so searching by fid always works regardless of searchKeys index state.
      const { GET } = await import('@/app/api/setu/family/search/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'GET',
        `/api/setu/family/search?q=${encodeURIComponent(fidA)}`,
        null,
        { role: 'welcome-team' },
      );

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { hits: Array<{ fid: string; name: string }> };
      const fids = json.hits.map((h) => h.fid);
      expect(fids).toContain(fidA);
    });

    it('GET search?q=<fidB> returns family B by direct fid lookup', async () => {
      const { GET } = await import('@/app/api/setu/family/search/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'GET',
        `/api/setu/family/search?q=${encodeURIComponent(fidB)}`,
        null,
        { role: 'welcome-team' },
      );

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { hits: Array<{ fid: string }> };
      const fids = json.hits.map((h) => h.fid);
      expect(fids).toContain(fidB);
    });

    it('GET search?q=<family-a-email> returns only family A', async () => {
      const { GET } = await import('@/app/api/setu/family/search/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'GET',
        `/api/setu/family/search?q=${encodeURIComponent(FAMILY_A_EMAIL)}`,
        null,
        { role: 'welcome-team' },
      );

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { hits: Array<{ fid: string }> };
      const fids = json.hits.map((h) => h.fid);

      expect(fids).toContain(fidA);
      expect(fids).not.toContain(fidB);
    });

    it('GET search?q=<family-b-email> returns only family B', async () => {
      const { GET } = await import('@/app/api/setu/family/search/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'GET',
        `/api/setu/family/search?q=${encodeURIComponent(FAMILY_B_EMAIL)}`,
        null,
        { role: 'welcome-team' },
      );

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { hits: Array<{ fid: string }> };
      const fids = json.hits.map((h) => h.fid);

      expect(fids).not.toContain(fidA);
      expect(fids).toContain(fidB);
    });

    it('GET search without welcome-team role returns 403', async () => {
      const { GET } = await import('@/app/api/setu/family/search/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'GET',
        `/api/setu/family/search?q=${encodeURIComponent(SEARCH_PREFIX)}`,
        null,
        { role: 'family-manager' },
      );

      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('GET search with no session returns 401', async () => {
      const { GET } = await import('@/app/api/setu/family/search/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'GET',
        `/api/setu/family/search?q=${encodeURIComponent(SEARCH_PREFIX)}`,
        null,
        {},
      );

      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  },
);
