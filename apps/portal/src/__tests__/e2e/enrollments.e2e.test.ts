/**
 * E2E: Enrollment flow
 *
 * Exercises POST/GET/DELETE /api/setu/enrollments and
 * POST/PATCH /api/welcome/enrollments against real UAT Firestore.
 *
 * Headline invariant: suggestedAmountSnapshot is pinned at enrollment time —
 * mutating donationPeriods.suggestedAmount after enroll must NOT change
 * effectiveSuggestedAmount on an existing enrollment.
 *
 * All test docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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

const hasUatCreds =
  process.env['PORTAL_FIREBASE_PROJECT_ID'] === 'chinmaya-setu-uat' &&
  !!process.env['PORTAL_FIREBASE_CLIENT_EMAIL'] &&
  !!process.env['PORTAL_FIREBASE_PRIVATE_KEY'];

(hasUatCreds ? describe : describe.skip)(
  'E2E: Enrollment flow — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const TS = Date.now().toString();

    // Donation period with dates that straddle now so the window is always open
    const PERIOD_LABEL = `E2E Enroll ${RUN_ID}`;
    const PROGRAM_KEY = 'bala-vihar';
    const LOCATION = 'Brampton';
    // startDate well in the past, endDate well in the future
    const START_DATE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const END_DATE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const SUGGESTED_AMOUNT = 500;

    // Unique family contact data so runs don't collide
    const FAMILY_NAME = `e2eenroll${RUN_ID.toLowerCase()} family`;
    const FAMILY_EMAIL = `e2eenroll${RUN_ID.toLowerCase()}@test.cmt.invalid`;
    const FAMILY_PHONE = `416${TS.slice(-7)}`;

    let fid: string;
    let pid: string;
    let eid: string;

    beforeAll(async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      // Create test family
      const family = await createTestFamily({
        name: FAMILY_NAME,
        email: FAMILY_EMAIL,
        phone: FAMILY_PHONE,
        location: 'Brampton',
      });
      fid = family.fid;

      // Create test donation period directly in Firestore (bypassing admin API
      // so this suite has no dependency on the admin route being up)
      const slugLabel = PERIOD_LABEL.toLowerCase().replace(/\s+/g, '-');
      const slugLocation = LOCATION.toLowerCase();
      pid = `${PROGRAM_KEY}-${slugLocation}-${slugLabel}`;

      await db.collection('donationPeriods').doc(pid).set({
        pid,
        programKey: PROGRAM_KEY,
        programLabel: 'Bala Vihar',
        location: LOCATION,
        periodLabel: PERIOD_LABEL,
        startDate: new Date(START_DATE),
        endDate: new Date(END_DATE),
        // Far-past tier so resolveSuggestedAmount(period, now) === SUGGESTED_AMOUNT
        pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: SUGGESTED_AMOUNT, label: 'Full year' }],
        enabled: true,
        createdAt: new Date(),
        createdBy: `e2e-setup-${RUN_ID}`,
        updatedAt: new Date(),
        updatedBy: `e2e-setup-${RUN_ID}`,
        _test: true,
      });
    });

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e enrollments] cleanup error (non-fatal):', err);
      }
    });

    // ── POST /api/setu/enrollments ──────────────────────────────────────────

    it('POST /api/setu/enrollments — creates enrollment, returns 201 + eid + suggestedAmount', async () => {
      const { POST } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/setu/enrollments', { pid }, {
        role: 'family-manager',
        fid,
        mid: `mid-${RUN_ID}`,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const body = (await res.json()) as { eid: string; suggestedAmount: number; donateUrl: string };
      expect(body.eid).toBe(`${fid}-${pid}`);
      expect(body.suggestedAmount).toBe(SUGGESTED_AMOUNT);
      expect(body.donateUrl).toContain(body.eid);

      eid = body.eid;

      // Tag enrollment doc for cleanup
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .set({ _test: true }, { merge: true });
    });

    it('POST same pid again — idempotent, returns 200 with same eid', async () => {
      expect(eid).toBeTruthy();
      const { POST } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/setu/enrollments', { pid }, {
        role: 'family-manager',
        fid,
        mid: `mid-${RUN_ID}`,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { eid: string };
      expect(body.eid).toBe(eid);
    });

    // ── Snapshot invariant ──────────────────────────────────────────────────

    it('snapshot invariant — mutating period.pricingTiers does NOT change effectiveSuggestedAmount on existing enrollment', async () => {
      expect(eid).toBeTruthy();

      // Step 1: assert enrollment snapshot is pinned at 500
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const enrollSnap = await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .get();
      expect(enrollSnap.exists).toBe(true);
      const enrollData = enrollSnap.data() as Record<string, unknown>;
      expect(enrollData['suggestedAmountSnapshot']).toBe(500);

      // Step 2: directly mutate period.pricingTiers in Firestore (bypass API)
      await db.collection('donationPeriods').doc(pid).update({
        pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: 800, label: 'Full year' }],
      });

      // Step 3: re-fetch enrollment via GET /api/setu/enrollments
      const { GET } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('GET', '/api/setu/enrollments', null, {
        role: 'family-manager',
        fid,
      });
      const res = await GET(req);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { enrollments: Array<{ eid: string; effectiveSuggestedAmount: number }> };
      const match = body.enrollments.find((e) => e.eid === eid);
      expect(match).toBeTruthy();

      // Step 4: effectiveSuggestedAmount must still be 500, not 800
      expect(match!.effectiveSuggestedAmount).toBe(500);
    });

    // ── GET /api/setu/enrollments ───────────────────────────────────────────

    it('GET /api/setu/enrollments — returns active enrollment in list', async () => {
      expect(eid).toBeTruthy();
      const { GET } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('GET', '/api/setu/enrollments', null, {
        role: 'family-manager',
        fid,
      });

      const res = await GET(req);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { enrollments: Array<{ eid: string; status: string }> };
      const match = body.enrollments.find((e) => e.eid === eid);
      expect(match).toBeTruthy();
      expect(match!.status).toBe('active');
    });

    it('GET without x-portal-fid returns 401', async () => {
      const { GET } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('GET', '/api/setu/enrollments', null, {
        role: 'family-manager',
        // no fid
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    // ── Welcome-team POST /api/welcome/enrollments ──────────────────────────

    it('welcome-team POST /api/welcome/enrollments — enrolls with enrolledVia=welcome-team', async () => {
      expect(fid).toBeTruthy();
      expect(pid).toBeTruthy();

      // Cancel the existing enrollment first so welcome-team can create a fresh one
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .update({ status: 'cancelled', cancelledAt: new Date(), cancelledReason: 'test-reset' });

      // Also reset the period pricing so the welcome enroll snapshot is predictable
      await db.collection('donationPeriods').doc(pid).update({
        pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: SUGGESTED_AMOUNT, label: 'Full year' }],
      });

      const { POST } = await import('@/app/api/welcome/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/welcome/enrollments', { fid, pid }, {
        role: 'welcome-team',
      });

      const res = await POST(req);
      // Cancelled enrollment → txn creates a fresh doc → must be 201
      expect(res.status).toBe(201);

      const body = (await res.json()) as { eid: string; suggestedAmount: number };
      expect(body.eid).toBe(`${fid}-${pid}`);
      expect(body.suggestedAmount).toBe(SUGGESTED_AMOUNT);

      // Verify enrolledVia in Firestore
      const enrollSnap = await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(body.eid)
        .get();
      expect(enrollSnap.exists).toBe(true);
      const data = enrollSnap.data() as Record<string, unknown>;
      expect(data['enrolledVia']).toBe('welcome-team');

      // Re-tag for cleanup (doc was overwritten by txn.set)
      await enrollSnap.ref.set({ _test: true }, { merge: true });
    });

    it('welcome-team PATCH /api/welcome/enrollments/[eid] — writes suggestedAmountOverride', async () => {
      expect(eid).toBeTruthy();
      const { PATCH } = await import('@/app/api/welcome/enrollments/[eid]/override/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'PATCH',
        `/api/welcome/enrollments/${eid}`,
        { suggestedAmountOverride: 750 },
        { role: 'welcome-team' },
      );

      const res = await PATCH(req, { params: Promise.resolve({ eid }) });
      expect(res.status).toBe(200);

      // Verify override persisted in Firestore
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const enrollSnap = await portalFirestore()
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .get();
      const data = enrollSnap.data() as Record<string, unknown>;
      expect(data['suggestedAmountOverride']).toBe(750);
    });

    it('family-member role POST /api/setu/enrollments returns 403', async () => {
      const { POST } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/setu/enrollments', { pid }, {
        role: 'family-member',
        fid,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('manager-required');
    });

    // ── DELETE /api/setu/enrollments/[eid] ─────────────────────────────────

    it('DELETE /api/setu/enrollments/[eid] — sets status to cancelled', async () => {
      expect(eid).toBeTruthy();

      // Re-activate the enrollment so we have something to cancel
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .update({ status: 'active', cancelledAt: null, cancelledReason: null });

      const { DELETE } = await import('@/app/api/setu/enrollments/[eid]/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('DELETE', `/api/setu/enrollments/${eid}`, null, {
        role: 'family-manager',
        fid,
      });

      const res = await DELETE(req, { params: Promise.resolve({ eid }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Verify status in Firestore
      const snap = await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .get();
      const data = snap.data() as Record<string, unknown>;
      expect(data['status']).toBe('cancelled');
      expect(data['cancelledReason']).toBe('family-initiated');
    });
  },
);
