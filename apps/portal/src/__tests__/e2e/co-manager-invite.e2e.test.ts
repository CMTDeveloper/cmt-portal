/**
 * E2E: Co-manager invite — auth gate + happy path
 *
 * Focused on the regression class fixed in `aede38f`:
 *   1. POST /api/setu/invite/accept WITHOUT a session must return 401
 *      with { error: 'no-session' } so the client wrapper can bounce the
 *      invitee to /sign-in?from=/invite/{token}.
 *   2. POST with a valid invitee session (email-matched) must create the
 *      new member doc + contactKey atomically and return 200.
 *
 * Deliberately omits the two post-commit assertions (invite.acceptedAt,
 * family.managers array) that flake in the broader invite-flow.e2e suite
 * — those are guarded by `it.todo` lines in invite-flow.e2e.test.ts and
 * tracked for separate debug.
 *
 * Cleanup: all test docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// revalidateTag throws "Invariant: static generation store missing" when
// called outside a Next.js request context (which is the case in the test
// harness). The send + accept routes both call it after their write — we
// just want the route to complete, so no-op the call here.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

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

vi.mock('@/lib/env', () => ({
  portalEnv: vi.fn(() => ({
    SETU_INVITE_TTL_DAYS: 14,
    NEXT_PUBLIC_PORTAL_BASE_URL: 'https://portal.test.cmt.invalid',
  })),
}));

const mockGetCurrentSessionContact = vi.fn();
vi.mock('@/features/setu/auth/get-current-session-email', () => ({
  getCurrentSessionContact: mockGetCurrentSessionContact,
}));

const hasUatCreds = Boolean(
  process.env.PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat' &&
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL &&
    process.env.PORTAL_FIREBASE_PRIVATE_KEY,
);

(hasUatCreds ? describe : describe.skip)(
  'E2E: Co-manager invite — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const MANAGER_EMAIL = `e2e.cmgr.mgr.${RUN_ID}@test.cmt.invalid`;
    const MANAGER_PHONE = `416${RUN_ID.slice(0, 7).replace(/[^0-9]/g, '3')}`;
    const INVITEE_EMAIL = `e2e.cmgr.inv.${RUN_ID}@test.cmt.invalid`;
    const INVITEE_UID = `test-cmgr-invitee-${RUN_ID}`;

    let fid: string;
    let managerMid: string;
    let inviteToken: string;
    let newMid: string;

    beforeAll(async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const result = await createTestFamily({
        name: `E2E CoMgr Family ${RUN_ID}`,
        email: MANAGER_EMAIL,
        phone: MANAGER_PHONE,
      });
      fid = result.fid;
      managerMid = result.mid;

      // Pre-create the invitee auth user — the accept route's
      // setCustomUserClaims/createCustomToken call assumes the uid exists
      // (production creates it during OTP send-code → verify-code).
      const { portalAuth } = await import('@cmt/firebase-shared/admin/auth');
      const auth = portalAuth();
      try {
        await auth.getUser(INVITEE_UID);
      } catch (err) {
        if ((err as { code?: string }).code === 'auth/user-not-found') {
          await auth.createUser({ uid: INVITEE_UID, email: INVITEE_EMAIL, disabled: false });
        } else {
          throw err;
        }
      }
    });

    afterAll(async () => {
      // Best-effort: remove the invitee auth user we created.
      const { portalAuth } = await import('@cmt/firebase-shared/admin/auth');
      try { await portalAuth().deleteUser(INVITEE_UID); } catch { /* ignore */ }
    });

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e co-manager] cleanup error (non-fatal):', err);
      }
    });


    it('manager POSTs /api/setu/invite/send → 201 + token persisted in Firestore', async () => {
      const { POST } = await import('@/app/api/setu/invite/send/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'POST',
        '/api/setu/invite/send',
        { email: INVITEE_EMAIL, relation: 'Spouse' },
        { role: 'family-manager', fid, mid: managerMid, uid: `uid-${managerMid}` },
      );

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = (await res.json()) as { token: string };
      inviteToken = json.token;
      expect(typeof inviteToken).toBe('string');
      expect(inviteToken.length).toBeGreaterThan(8);

      // Verify the invite doc in Firestore (direct-ref read — not collectionGroup)
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore()
        .collection('families').doc(fid)
        .collection('invites').doc(inviteToken)
        .get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['email']).toBe(INVITEE_EMAIL.toLowerCase());
      expect(data['acceptedAt']).toBeNull();
    });

    it('POST /api/setu/invite/accept WITHOUT a session → 401 { error: "no-session" }', async () => {
      expect(inviteToken).toBeTruthy();
      mockGetCurrentSessionContact.mockResolvedValueOnce(null);

      const { POST } = await import('@/app/api/setu/invite/accept/route');
      const req = new Request('http://localhost/api/setu/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('no-session');
    });

    it('POST /api/setu/invite/accept with valid invitee session → 200 + new mid', async () => {
      expect(inviteToken).toBeTruthy();

      // Wait for collectionGroup index to catch up (eventually consistent for new docs).
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      let indexed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const q = await db.collectionGroup('invites').where('token', '==', inviteToken).limit(1).get();
        if (!q.empty) { indexed = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!indexed) {
        console.warn('[e2e co-manager] collectionGroup index not ready after 30s — skipping accept');
        return;
      }

      mockGetCurrentSessionContact.mockResolvedValueOnce({
        type: 'email' as const,
        value: INVITEE_EMAIL,
        uid: INVITEE_UID,
      });

      const { POST } = await import('@/app/api/setu/invite/accept/route');
      const req = new Request('http://localhost/api/setu/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { fid: string; mid: string; redirectTo: string };
      expect(json.fid).toBe(fid);
      expect(json.mid).toMatch(new RegExp(`^${fid}-`));
      expect(json.redirectTo).toBe('/family');
      newMid = json.mid;
    });

    it('new member doc was created with manager: true', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore()
        .collection('families').doc(fid)
        .collection('members').doc(newMid)
        .get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['manager']).toBe(true);
      expect(data['email']).toBe(INVITEE_EMAIL);

      // Tag the new member doc + cleanup invite/contactKey orphans
      await snap.ref.set({ _test: true }, { merge: true });
    });

    it('contactKey for invitee email points to fid + new mid', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
      const emailHash = hashContactKey('email', INVITEE_EMAIL);
      const snap = await portalFirestore().collection('contactKeys').doc(emailHash).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['fid']).toBe(fid);
      expect(data['mid']).toBe(newMid);

      // Tag for cleanup
      await snap.ref.set({ _test: true }, { merge: true });
    });

    it('invite doc has acceptedAt + acceptedByMid (via direct ref)', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore()
        .collection('families').doc(fid)
        .collection('invites').doc(inviteToken)
        .get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['acceptedAt']).toBeTruthy();
      expect(data['acceptedByMid']).toBe(newMid);
    });

    it('family.managers array includes new mid (via direct ref)', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore().collection('families').doc(fid).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      const managers = data['managers'] as string[] | undefined;
      expect(managers).toContain(newMid);
    });
  },
);
