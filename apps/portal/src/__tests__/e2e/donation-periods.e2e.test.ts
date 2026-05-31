/**
 * E2E: Offerings CRUD (formerly donation-periods)
 *
 * Exercises GET/POST/PATCH /api/admin/offerings against real UAT Firestore.
 * All test offering docs carry `_test: true`. afterAll runs cleanupTestData().
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

// getProgram is called by the POST offerings route to resolve programLabel
vi.mock('@/features/setu/programs/get-programs', () => ({
  getProgram: vi.fn().mockResolvedValue({ programKey: 'bala-vihar', label: 'Bala Vihar', status: 'active' }),
  listPrograms: vi.fn().mockResolvedValue([]),
  assertProgramActive: vi.fn().mockResolvedValue({ programKey: 'bala-vihar', status: 'active' }),
}));

const hasUatCreds = Boolean(
  process.env.PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat' &&
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL &&
    process.env.PORTAL_FIREBASE_PRIVATE_KEY,
);

(hasUatCreds ? describe : describe.skip)(
  'E2E: Offerings CRUD — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();

    // Dates well in the future so the offering is always "active" during test runs
    const START_DATE = '2030-09-01T04:00:00.000Z';
    const END_DATE = '2030-12-31T04:59:59.000Z';

    // Derive the same oid the route derives so we can read the Firestore doc directly
    const TERM_LABEL = `E2E Test ${RUN_ID}`;
    const LOCATION = 'Mississauga';
    const PROGRAM_KEY = 'bala-vihar';
    const EXPECTED_OID = `${PROGRAM_KEY}-${LOCATION.toLowerCase()}-e2e-test-${RUN_ID.toLowerCase()}`;

    let createdOid: string;

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
        console.error('[e2e offerings] cleanup error (non-fatal):', err);
      }
    });

    it('POST /api/admin/offerings — creates offering, returns 201 + oid', async () => {
      const { POST } = await import('@/app/api/admin/offerings/route');

      const res = await POST(
        makeAdminRequest('POST', '/api/admin/offerings', {
          programKey: PROGRAM_KEY,
          location: LOCATION,
          termLabel: TERM_LABEL,
          termType: 'term',
          startDate: START_DATE,
          endDate: END_DATE,
          pricingTiers: [
            { effectiveFrom: '2030-09-01', amountCAD: 500, label: 'Full year' },
            { effectiveFrom: '2030-12-01', amountCAD: 300, label: 'Joined winter' },
          ],
          enabled: true,
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { oid: string; overlapWarning: boolean };
      expect(body.oid).toBe(EXPECTED_OID);
      expect(typeof body.overlapWarning).toBe('boolean');
      createdOid = body.oid;
    });

    it('offering doc exists in Firestore with correct shape', async () => {
      expect(createdOid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db.collection('offerings').doc(createdOid).get();
      expect(snap.exists).toBe(true);

      const data = snap.data() as Record<string, unknown>;
      expect(data['programKey']).toBe(PROGRAM_KEY);
      expect(data['location']).toBe(LOCATION);
      expect(data['termLabel']).toBe(TERM_LABEL);
      expect(data['termType']).toBe('term');
      expect(Array.isArray(data['pricingTiers'])).toBe(true);
      expect((data['pricingTiers'] as unknown[]).length).toBe(2);
      expect(data['enabled']).toBe(true);
      expect(data['createdBy']).toBe(ADMIN_UID);

      // Tag for cleanup
      await snap.ref.set({ _test: true }, { merge: true });
    });

    it('GET /api/admin/offerings — returns created offering in list', async () => {
      expect(createdOid).toBeTruthy();
      const { GET } = await import('@/app/api/admin/offerings/route');

      const res = await GET(makeAdminRequest('GET', '/api/admin/offerings'));
      expect(res.status).toBe(200);

      const body = (await res.json()) as { offerings: Array<{ oid: string }> };
      const oids = body.offerings.map((o) => o.oid);
      expect(oids).toContain(createdOid);
    });

    it('PATCH /api/admin/offerings/[oid] — updates pricingTiers, returns 200', async () => {
      expect(createdOid).toBeTruthy();
      const { PATCH } = await import('@/app/api/admin/offerings/[oid]/route');

      const res = await PATCH(
        makeAdminRequest('PATCH', `/api/admin/offerings/${createdOid}`, {
          pricingTiers: [{ effectiveFrom: '2030-09-01', amountCAD: 750, label: 'Full year' }],
        }),
        { params: Promise.resolve({ oid: createdOid }) },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { oid: string };
      expect(body.oid).toBe(createdOid);
    });

    it('updated pricingTiers is persisted in Firestore', async () => {
      expect(createdOid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db.collection('offerings').doc(createdOid).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      const tiers = data['pricingTiers'] as Array<{ amountCAD: number }>;
      expect(tiers).toHaveLength(1);
      expect(tiers[0]!.amountCAD).toBe(750);
      expect(data['updatedBy']).toBe(ADMIN_UID);
    });

    it('PATCH — disabling offering persists enabled:false', async () => {
      expect(createdOid).toBeTruthy();
      const { PATCH } = await import('@/app/api/admin/offerings/[oid]/route');

      const res = await PATCH(
        makeAdminRequest('PATCH', `/api/admin/offerings/${createdOid}`, {
          enabled: false,
        }),
        { params: Promise.resolve({ oid: createdOid }) },
      );
      expect(res.status).toBe(200);

      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore().collection('offerings').doc(createdOid).get();
      const data = snap.data() as Record<string, unknown>;
      expect(data['enabled']).toBe(false);
    });

    it('PATCH — returns 404 for a non-existent oid', async () => {
      const { PATCH } = await import('@/app/api/admin/offerings/[oid]/route');

      const res = await PATCH(
        makeAdminRequest('PATCH', '/api/admin/offerings/does-not-exist', { enabled: true }),
        { params: Promise.resolve({ oid: 'does-not-exist' }) },
      );
      expect(res.status).toBe(404);
    });

    it('POST without x-portal-uid returns 401', async () => {
      const { POST } = await import('@/app/api/admin/offerings/route');

      const res = await POST(
        makeNonAdminRequest('POST', '/api/admin/offerings', {
          programKey: PROGRAM_KEY,
          location: LOCATION,
          termLabel: `No Auth ${RUN_ID}`,
          termType: 'term',
          startDate: START_DATE,
          endDate: END_DATE,
          pricingTiers: [{ effectiveFrom: '2030-09-01', amountCAD: 500, label: 'Full year' }],
          enabled: true,
        }),
      );
      // Non-admin request has no x-portal-uid header so returns 401
      expect(res.status).toBe(401);
    });
  },
);
