/**
 * E2E: Donation periods CRUD
 *
 * Exercises GET/POST/PATCH /api/admin/donation-periods against real UAT Firestore.
 * All test period docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
  headers: vi.fn(() => new Headers()),
}));

const hasUatCreds = Boolean(
  process.env.PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat' &&
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL &&
    process.env.PORTAL_FIREBASE_PRIVATE_KEY,
);

(hasUatCreds ? describe : describe.skip)(
  'E2E: Donation periods CRUD — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();

    // Dates well in the future so the period is always "active" during test runs
    const START_DATE = '2030-09-01T04:00:00.000Z';
    const END_DATE = '2030-12-31T04:59:59.000Z';

    // Derive the same pid the route derives so we can read the Firestore doc directly
    const PERIOD_LABEL = `E2E Test ${RUN_ID}`;
    const LOCATION = 'Mississauga';
    const PROGRAM_KEY = 'bala-vihar';
    const EXPECTED_PID = `${PROGRAM_KEY}-${LOCATION.toLowerCase()}-e2e-test-${RUN_ID.toLowerCase()}`;

    let createdPid: string;

    const ADMIN_UID = `e2e-admin-${RUN_ID}`;

    function makeAdminRequest(method: string, url: string, body?: unknown): Request {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-portal-uid': ADMIN_UID,
        'x-portal-role': 'admin',
      };
      return new Request(`http://localhost${url}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    }

    function makeNonAdminRequest(method: string, url: string, body?: unknown): Request {
      return new Request(`http://localhost${url}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-portal-role': 'family-manager' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    }

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e donation-periods] cleanup error (non-fatal):', err);
      }
    });

    it('POST /api/admin/donation-periods — creates period, returns 201 + pid', async () => {
      const { POST } = await import('@/app/api/admin/donation-periods/route');

      const res = await POST(
        makeAdminRequest('POST', '/api/admin/donation-periods', {
          programKey: PROGRAM_KEY,
          location: LOCATION,
          periodLabel: PERIOD_LABEL,
          startDate: START_DATE,
          endDate: END_DATE,
          pricingTiers: [
            { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' },
            { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'Joined winter' },
          ],
          enabled: true,
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { pid: string; overlapWarning: boolean };
      expect(body.pid).toBe(EXPECTED_PID);
      expect(typeof body.overlapWarning).toBe('boolean');
      createdPid = body.pid;
    });

    it('period doc exists in Firestore with correct shape', async () => {
      expect(createdPid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db.collection('donationPeriods').doc(createdPid).get();
      expect(snap.exists).toBe(true);

      const data = snap.data() as Record<string, unknown>;
      expect(data['programKey']).toBe(PROGRAM_KEY);
      expect(data['location']).toBe(LOCATION);
      expect(data['periodLabel']).toBe(PERIOD_LABEL);
      expect(Array.isArray(data['pricingTiers'])).toBe(true);
      expect((data['pricingTiers'] as unknown[]).length).toBe(2);
      expect(data['enabled']).toBe(true);
      expect(data['createdBy']).toBe(ADMIN_UID);

      // Tag for cleanup
      await snap.ref.set({ _test: true }, { merge: true });
    });

    it('GET /api/admin/donation-periods — returns created period in list', async () => {
      expect(createdPid).toBeTruthy();
      const { GET } = await import('@/app/api/admin/donation-periods/route');

      const res = await GET(makeAdminRequest('GET', '/api/admin/donation-periods'));
      expect(res.status).toBe(200);

      const body = (await res.json()) as { periods: Array<{ pid: string }> };
      const pids = body.periods.map((p) => p.pid);
      expect(pids).toContain(createdPid);
    });

    it('PATCH /api/admin/donation-periods/[pid] — updates pricingTiers, returns 200', async () => {
      expect(createdPid).toBeTruthy();
      const { PATCH } = await import('@/app/api/admin/donation-periods/[pid]/route');

      const res = await PATCH(
        makeAdminRequest('PATCH', `/api/admin/donation-periods/${createdPid}`, {
          pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 750, label: 'Full year' }],
        }),
        { params: Promise.resolve({ pid: createdPid }) },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { pid: string };
      expect(body.pid).toBe(createdPid);
    });

    it('updated pricingTiers is persisted in Firestore', async () => {
      expect(createdPid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db.collection('donationPeriods').doc(createdPid).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      const tiers = data['pricingTiers'] as Array<{ amountCAD: number }>;
      expect(tiers).toHaveLength(1);
      expect(tiers[0]!.amountCAD).toBe(750);
      expect(data['updatedBy']).toBe(ADMIN_UID);
    });

    it('PATCH — disabling period persists enabled:false', async () => {
      expect(createdPid).toBeTruthy();
      const { PATCH } = await import('@/app/api/admin/donation-periods/[pid]/route');

      const res = await PATCH(
        makeAdminRequest('PATCH', `/api/admin/donation-periods/${createdPid}`, {
          enabled: false,
        }),
        { params: Promise.resolve({ pid: createdPid }) },
      );
      expect(res.status).toBe(200);

      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore().collection('donationPeriods').doc(createdPid).get();
      const data = snap.data() as Record<string, unknown>;
      expect(data['enabled']).toBe(false);
    });

    it('PATCH — returns 404 for a non-existent pid', async () => {
      const { PATCH } = await import('@/app/api/admin/donation-periods/[pid]/route');

      const res = await PATCH(
        makeAdminRequest('PATCH', '/api/admin/donation-periods/does-not-exist', { enabled: true }),
        { params: Promise.resolve({ pid: 'does-not-exist' }) },
      );
      expect(res.status).toBe(404);
    });

    it('POST without x-portal-uid returns 401', async () => {
      const { POST } = await import('@/app/api/admin/donation-periods/route');

      const res = await POST(
        makeNonAdminRequest('POST', '/api/admin/donation-periods', {
          programKey: PROGRAM_KEY,
          location: LOCATION,
          periodLabel: `No Auth ${RUN_ID}`,
          startDate: START_DATE,
          endDate: END_DATE,
          pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' }],
          enabled: true,
        }),
      );
      // Non-admin request has no x-portal-uid header so returns 401
      expect(res.status).toBe(401);
    });
  },
);
