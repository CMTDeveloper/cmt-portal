/**
 * E2E: Enrollment flow
 *
 * Exercises POST/GET/DELETE /api/setu/enrollments and
 * POST/PATCH /api/welcome/enrollments against real UAT Firestore.
 *
 * Headline invariant: suggestedAmountSnapshot is pinned at enrollment time —
 * mutating offering.pricingTiers after enroll must NOT change
 * effectiveSuggestedAmount on an existing enrollment.
 *
 * The Multi-Program refactor moved the source-of-truth from `donationPeriods`
 * to the `offerings` collection (body key `oid`, eid = `{fid}-{oid}`) and made
 * enroll-family assert the parent program is active (reads `programs/{key}`).
 * This suite creates a dedicated `_test`-prefixed program + matching offering so
 * cleanup never touches the real `bala-vihar` program seeded in UAT.
 *
 * All test docs carry `_test: true`. afterAll runs cleanupTestData() (families /
 * contactKeys / enrollments collection-group) and explicitly deletes the
 * offering + program docs (cleanupTestData does not sweep those collections).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  // get-programs.ts (via assertProgramActive) uses Cache Components helpers.
  // Without these the cached read throws outside a Next request scope.
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

    // Dedicated _test program key (lowercase slug, never the real bala-vihar program).
    // programKeySchema requires /^[a-z0-9-]+$/ so no underscore in the key itself.
    const PROGRAM_KEY = `e2e-enroll-${RUN_ID.toLowerCase()}`;
    const PROGRAM_LABEL = 'E2E Enroll Program';

    // Offering with dates that straddle now so the enrollment window is always open.
    const TERM_LABEL = `E2E Enroll ${RUN_ID}`;
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
    let oid: string;
    let eid: string;

    beforeAll(async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      // Create test family (also seeds a child member so enrolledMids is non-empty)
      const family = await createTestFamily({
        name: FAMILY_NAME,
        email: FAMILY_EMAIL,
        phone: FAMILY_PHONE,
        location: 'Brampton',
      });
      fid = family.fid;

      // Create the parent program — enroll-family asserts programs/{key}.status === 'active'.
      // Tagged _test:true and deleted in afterAll (cleanupTestData does not sweep `programs`).
      await db.collection('programs').doc(PROGRAM_KEY).set({
        programKey: PROGRAM_KEY,
        label: PROGRAM_LABEL,
        shortDescription: '',
        status: 'active',
        locations: [LOCATION],
        termType: 'term',
        eligibility: { memberType: 'child' },
        capabilities: {
          usesOfferings: true,
          usesDonation: true,
          usesLevels: false,
          usesCalendar: false,
          attendanceMode: 'none',
        },
        displayOrder: 0,
        createdAt: new Date(),
        createdBy: `e2e-setup-${RUN_ID}`,
        updatedAt: new Date(),
        updatedBy: `e2e-setup-${RUN_ID}`,
        _test: true,
      });

      // Create test offering directly in Firestore (bypassing the admin API so this
      // suite has no dependency on the admin route being up). eid = `{fid}-{oid}`.
      const slugLabel = TERM_LABEL.toLowerCase().replace(/\s+/g, '-');
      const slugLocation = LOCATION.toLowerCase();
      oid = `${PROGRAM_KEY}-${slugLocation}-${slugLabel}`;

      await db.collection('offerings').doc(oid).set({
        oid,
        programKey: PROGRAM_KEY,
        programLabel: PROGRAM_LABEL,
        location: LOCATION,
        termLabel: TERM_LABEL,
        termType: 'term',
        startDate: new Date(START_DATE),
        endDate: new Date(END_DATE),
        // Far-past tier so resolveSuggestedAmount(offering, now) === SUGGESTED_AMOUNT
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
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const { cleanupTestData } = await import('./helpers/firestore');
      const db = portalFirestore();

      // cleanupTestData sweeps families / contactKeys / donationPeriods / enrollments,
      // but NOT offerings or programs — delete those explicitly.
      try {
        if (oid) await db.collection('offerings').doc(oid).delete();
      } catch (err) {
        console.error('[e2e enrollments] offering cleanup error (non-fatal):', err);
      }
      try {
        await db.collection('programs').doc(PROGRAM_KEY).delete();
      } catch (err) {
        console.error('[e2e enrollments] program cleanup error (non-fatal):', err);
      }

      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e enrollments] cleanup error (non-fatal):', err);
      }
    });

    // ── Lazy publicFid mint (Model Y2) ──────────────────────────────────────

    it('mints publicFid on the family FIRST enrollment and reuses it on the next (no re-mint / no burn)', async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const { portalFirestore, FieldValue } = await import('@cmt/firebase-shared/admin/firestore');
      const { enrollFamily } = await import('@/features/setu/enrollment/enroll-family');
      const db = portalFirestore();

      // A dedicated family created WITHOUT a publicFid (registerFamily no longer
      // mints one; the delete below is defensive). Add a Child so the BV
      // (child-only) offering has an eligible member (createTestFamily seeds only
      // the adult manager).
      const mint = await createTestFamily({
        name: `e2emint${RUN_ID.toLowerCase()} family`,
        email: `e2emint${RUN_ID.toLowerCase()}@test.cmt.invalid`,
        phone: `416${TS.slice(-6)}9`,
        location: 'Brampton',
      });
      const mintFid = mint.fid;
      const childMid = `${mintFid}-child`;
      await db.collection('families').doc(mintFid).collection('members').doc(childMid).set({
        mid: childMid, type: 'Child', firstName: 'Mint', lastName: 'Child',
        birthMonthYear: null, manager: false, _test: true,
      });
      await db.collection('families').doc(mintFid).update({ publicFid: FieldValue.delete() });
      expect((await db.collection('families').doc(mintFid).get()).data()?.['publicFid']).toBeUndefined();

      // A second offering under the same program so the second enrollment is a
      // real multi-program enroll (created:true again), not an idempotent no-op.
      const oid2 = `${oid}-b`;
      await db.collection('offerings').doc(oid2).set({
        oid: oid2, programKey: PROGRAM_KEY, programLabel: PROGRAM_LABEL, location: LOCATION,
        termLabel: `${TERM_LABEL} B`, termType: 'term',
        startDate: new Date(START_DATE), endDate: new Date(END_DATE),
        pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: SUGGESTED_AMOUNT, label: 'Full year' }],
        enabled: true, createdAt: new Date(), createdBy: `e2e-setup-${RUN_ID}`,
        updatedAt: new Date(), updatedBy: `e2e-setup-${RUN_ID}`, _test: true,
      });

      try {
        // First enrollment -> mints a publicFid in the 5001+ band
        const first = await enrollFamily({ fid: mintFid, oid, enrolledVia: 'family-initiated', enrolledByMid: null });
        expect(first.created).toBe(true);
        await db.collection('families').doc(mintFid).collection('enrollments').doc(`${mintFid}-${oid}`).set({ _test: true }, { merge: true });
        const minted = (await db.collection('families').doc(mintFid).get()).data()?.['publicFid'];
        expect(typeof minted).toBe('string');
        expect(Number(minted)).toBeGreaterThanOrEqual(5001);

        // Second enrollment into a different offering keeps the SAME id (no re-mint)
        const second = await enrollFamily({ fid: mintFid, oid: oid2, enrolledVia: 'family-initiated', enrolledByMid: null });
        expect(second.created).toBe(true);
        await db.collection('families').doc(mintFid).collection('enrollments').doc(`${mintFid}-${oid2}`).set({ _test: true }, { merge: true });
        expect((await db.collection('families').doc(mintFid).get()).data()?.['publicFid']).toBe(minted);
      } finally {
        await db.collection('offerings').doc(oid2).delete().catch(() => {});
      }
    });

    // ── POST /api/setu/enrollments ──────────────────────────────────────────

    it('POST /api/setu/enrollments — creates enrollment, returns 201 + eid + suggestedAmount', async () => {
      const { POST } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/setu/enrollments', { oid }, {
        role: 'family-manager',
        fid,
        mid: `mid-${RUN_ID}`,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const body = (await res.json()) as { eid: string; suggestedAmount: number; donateUrl: string };
      expect(body.eid).toBe(`${fid}-${oid}`);
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

    it('POST same oid again — idempotent, returns 200 with same eid', async () => {
      expect(eid).toBeTruthy();
      const { POST } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/setu/enrollments', { oid }, {
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

    it('snapshot invariant — mutating offering.pricingTiers does NOT change effectiveSuggestedAmount on existing enrollment', async () => {
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

      // Step 2: directly mutate offering.pricingTiers in Firestore (bypass API)
      await db.collection('offerings').doc(oid).update({
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

    it('GET with a family session but no x-portal-fid returns 400 missing-fid', async () => {
      const { GET } = await import('@/app/api/setu/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      // A family-manager role header with no fid is a malformed session: the
      // route passes the no-session (401) and family (403) checks, then defends
      // with 400 missing-fid. (In production fid always arrives from the session
      // via middleware; this exercises the handler's defensive branch.)
      const req = makePortalRequest('GET', '/api/setu/enrollments', null, {
        role: 'family-manager',
        // no fid
      });

      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    // ── Welcome-team POST /api/welcome/enrollments ──────────────────────────

    it('welcome-team POST /api/welcome/enrollments — enrolls with enrolledVia=welcome-team', async () => {
      expect(fid).toBeTruthy();
      expect(oid).toBeTruthy();

      // Cancel the existing enrollment first so welcome-team can create a fresh one
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      await db
        .collection('families')
        .doc(fid)
        .collection('enrollments')
        .doc(eid)
        .update({ status: 'cancelled', cancelledAt: new Date(), cancelledReason: 'test-reset' });

      // Also reset the offering pricing so the welcome enroll snapshot is predictable
      await db.collection('offerings').doc(oid).update({
        pricingTiers: [{ effectiveFrom: '2020-01-01', amountCAD: SUGGESTED_AMOUNT, label: 'Full year' }],
      });

      const { POST } = await import('@/app/api/welcome/enrollments/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest('POST', '/api/welcome/enrollments', { fid, oid }, {
        role: 'welcome-team',
      });

      const res = await POST(req);
      // Cancelled enrollment → txn creates a fresh doc → must be 201
      expect(res.status).toBe(201);

      const body = (await res.json()) as { eid: string; suggestedAmount: number };
      expect(body.eid).toBe(`${fid}-${oid}`);
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

      const req = makePortalRequest('POST', '/api/setu/enrollments', { oid }, {
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
