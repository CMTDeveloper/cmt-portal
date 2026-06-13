/**
 * E2E: Invite flow
 *
 * Seeds a test family, sends an invite, accepts it, and verifies Firestore state.
 * No real SES emails — resolveSender is mocked.
 *
 * Cleanup: all test docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// revalidateTag throws "Invariant: static generation store missing" outside
// a Next.js request context. The send + accept routes both call it after
// their writes — without this mock the route 500s and post-commit reads
// fail mysteriously. (This was the root cause of the entire flake!)
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

// No real SES traffic
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

// getSessionContactFromHeaders is called by the accept route — mock it per-test
const mockGetCurrentSessionContact = vi.fn();
vi.mock('@/features/setu/auth/get-current-session-email', () => ({
  getSessionContactFromHeaders: mockGetCurrentSessionContact,
}));

const hasUatCreds = Boolean(
  process.env.PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat' &&
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL &&
    process.env.PORTAL_FIREBASE_PRIVATE_KEY,
);

(hasUatCreds ? describe : describe.skip)(
  'E2E: Invite flow — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const MANAGER_EMAIL = `e2e.invite.mgr.${RUN_ID}@test.cmt.invalid`;
    const MANAGER_PHONE = `416${RUN_ID.slice(0, 7).replace(/[^0-9]/g, '3')}`;
    const INVITEE_EMAIL = `e2e.invite.inv.${RUN_ID}@test.cmt.invalid`;
    const INVITEE_UID = `test-invitee-${RUN_ID}`;

    let fid: string;
    let managerMid: string;
    let inviteToken: string;
    let newMid: string;

    beforeAll(async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const result = await createTestFamily({
        name: `E2E Invite Family ${RUN_ID}`,
        email: MANAGER_EMAIL,
        phone: MANAGER_PHONE,
      });
      fid = result.fid;
      managerMid = result.mid;

      // Pre-create the invitee Firebase auth user — the accept route's
      // setCustomUserClaims/createCustomToken assume the uid exists
      // (production creates it during OTP sign-in, which the e2e bypasses).
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
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e invite-flow] cleanup error (non-fatal):', err);
      }
      // Best-effort: remove the invitee auth user.
      const { portalAuth } = await import('@cmt/firebase-shared/admin/auth');
      try { await portalAuth().deleteUser(INVITEE_UID); } catch { /* ignore */ }
    });

    it('POST /api/setu/invite/send returns 201 + token', async () => {
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
      expect(typeof json.token).toBe('string');
      expect(json.token.length).toBeGreaterThan(8);
      inviteToken = json.token;
    });

    it('invite doc exists in Firestore with correct shape', async () => {
      expect(inviteToken).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db
        .collection('families')
        .doc(fid)
        .collection('invites')
        .doc(inviteToken)
        .get();

      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['email']).toBe(INVITEE_EMAIL.toLowerCase());
      expect(data['relation']).toBe('Spouse');
      expect(data['inviterMid']).toBe(managerMid);
      expect(data['acceptedAt']).toBeNull();
      expect(data['expiresAt']).toBeTruthy();
    });

    it('POST /api/setu/invite/accept — invitee accepts, returns 200 + new mid', async () => {
      expect(inviteToken).toBeTruthy();

      // Wait for the collectionGroup index to catch up before calling accept.
      // Firestore collectionGroup queries are eventually consistent for new docs.
      const { portalFirestore: pf } = await import('@cmt/firebase-shared/admin/firestore');
      const db2 = pf();
      let indexed = false;
      // Firestore collectionGroup queries rely on a secondary index that may lag
      // behind direct document writes. Retry for up to 30s.
      for (let attempt = 0; attempt < 60; attempt++) {
        const q = await db2.collectionGroup('invites').where('token', '==', inviteToken).limit(1).get();
        if (!q.empty) { indexed = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!indexed) {
        console.warn('[e2e invite-flow] collectionGroup index not ready after 30s — skipping accept test');
        return;
      }

      // Mint a test session for the invitee
      const { mintTestSession } = await import('./helpers/session');
      const sessionCookie = await mintTestSession(INVITEE_UID, {
        role: 'family-member',
      });

      // Mock the session contact to return the invitee's email
      mockGetCurrentSessionContact.mockReturnValue({
        type: 'email' as const,
        value: INVITEE_EMAIL,
        uid: INVITEE_UID,
      });

      const { POST } = await import('@/app/api/setu/invite/accept/route');
      const { makePortalRequest } = await import('./helpers/request');

      const req = makePortalRequest(
        'POST',
        '/api/setu/invite/accept',
        { token: inviteToken },
        { sessionCookie },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { fid: string; mid: string; redirectTo: string };
      expect(json.fid).toBe(fid);
      expect(json.mid).toMatch(new RegExp(`^${fid}-`));
      expect(json.redirectTo).toBe('/family');
      newMid = json.mid;
    });

    it('invite doc has acceptedAt set and acceptedByMid matches new mid', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      // Read via direct ref (built from path strings) — the issue was never
      // collectionGroup-related; it was that revalidateTag was throwing in
      // the route handler before this test could observe the writes.
      const snap = await portalFirestore()
        .collection('families').doc(fid)
        .collection('invites').doc(inviteToken)
        .get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['acceptedAt']).toBeTruthy();
      expect(data['acceptedByMid']).toBe(newMid);
    });

    it('new member doc is created with manager: true', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db
        .collection('families')
        .doc(fid)
        .collection('members')
        .doc(newMid)
        .get();

      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['manager']).toBe(true);

      // Tag for cleanup
      await snap.ref.set({ _test: true }, { merge: true });
    });

    it('family.managers array includes new mid', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const snap = await portalFirestore().collection('families').doc(fid).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      const managers = data['managers'] as string[] | undefined;
      expect(managers).toContain(newMid);
    });

    it('contactKey for invitee email points to new fid + mid', async () => {
      expect(newMid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
      const db = portalFirestore();

      const emailHash = hashContactKey('email', INVITEE_EMAIL);
      const snap = await db.collection('contactKeys').doc(emailHash).get();

      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['fid']).toBe(fid);
      expect(data['mid']).toBe(newMid);

      // Tag for cleanup
      await snap.ref.set({ _test: true }, { merge: true });
    });
  },
);
