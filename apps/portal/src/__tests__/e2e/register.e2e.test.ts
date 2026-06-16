/**
 * E2E: Registration flow
 *
 * Hits real UAT Firestore (chinmaya-setu-uat). Requires .env.local with
 * PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat and matching service account creds.
 *
 * Cleanup: all test docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

// ── Guard: skip if UAT creds are missing ────────────────────────────────────
const hasUatCreds =
  !!process.env['PORTAL_FIREBASE_PROJECT_ID'] &&
  !!process.env['PORTAL_FIREBASE_CLIENT_EMAIL'] &&
  !!process.env['PORTAL_FIREBASE_PRIVATE_KEY'] &&
  !!process.env['NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY'];

// ── AWS SES mock — no real emails during tests ──────────────────────────────
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: () => ({
    sendEmail: vi.fn().mockResolvedValue(undefined),
    sendSMS: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ── Feature flag: enable setuAuth ───────────────────────────────────────────
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

// ── next/headers stub (route handler calls cookies() at import time) ────────
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
  headers: vi.fn(() => new Headers()),
}));

describe.skipIf(!hasUatCreds)(
  'E2E: POST /api/setu/register → real UAT Firestore',
  () => {
    let fid: string;
    let mid: string;

    // Use a unique suffix to avoid collisions across runs
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const EMAIL = `e2e.register.${RUN_ID}@test.cmt.invalid`;
    const PHONE = `555${RUN_ID.slice(0, 7).replace(/[^0-9]/g, '0')}`;

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e register] cleanup error (non-fatal):', err);
      }
    });

    it('returns 200 with fid + mid and sets __session cookie', async () => {
      const { POST } = await import(
        '@/app/api/setu/register/route'
      );
      // Registration now requires proof the email was OTP-verified — issue a
      // real grant (as verify-code would) so the route can consume it.
      const { issueRegistrationGrant } = await import('@/features/setu/registration/registration-grant');
      const registrationGrant = await issueRegistrationGrant(EMAIL);

      const body = {
        email: EMAIL,
        phone: PHONE,
        familyName: `E2E Family ${RUN_ID}`,
        location: 'Brampton',
        manager: { firstName: 'E2EFirst', lastName: 'E2ELast', gender: 'PreferNotToSay' },
        additionalMembers: [],
        registrationGrant,
      };

      const req = new Request('http://localhost/api/setu/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { fid: string; mid: string };
      expect(json.fid).toBeTruthy();
      expect(json.mid).toBeTruthy();
      fid = json.fid;
      mid = json.mid;

      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('__session');
    });

    it('families/{fid} doc has correct shape in Firestore', async () => {
      expect(fid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      // Tag for cleanup
      await db.collection('families').doc(fid).set({ _test: true }, { merge: true });

      const snap = await db.collection('families').doc(fid).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;

      expect(data['fid']).toBe(fid);
      expect(data['legacyFid']).toBeNull();
      expect(data['name']).toContain('E2E Family');
      expect(data['location']).toBe('Brampton');
      expect(Array.isArray(data['managers'])).toBe(true);
      expect((data['managers'] as string[])).toContain(mid);
      expect(Array.isArray(data['searchKeys'])).toBe(true);
    });

    it('families/{fid}/members/{mid} doc has correct shape', async () => {
      expect(fid && mid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      await db
        .collection('families')
        .doc(fid)
        .collection('members')
        .doc(mid)
        .set({ _test: true }, { merge: true });

      const snap = await db
        .collection('families')
        .doc(fid)
        .collection('members')
        .doc(mid)
        .get();

      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;

      expect(data['firstName']).toBe('E2EFirst');
      expect(data['lastName']).toBe('E2ELast');
      // registerFamily stores email as-is from the form input
      expect((data['email'] as string).toLowerCase()).toBe(EMAIL.toLowerCase());
      expect(data['manager']).toBe(true);
    });

    it('contactKeys/{emailHash} doc points to correct fid + mid', async () => {
      expect(fid && mid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const { hashContactKey } = await import(
        '@/features/setu/registration/hash-contact-key'
      );
      const db = portalFirestore();

      const emailHash = hashContactKey('email', EMAIL);
      const snap = await db.collection('contactKeys').doc(emailHash).get();

      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['fid']).toBe(fid);
      expect(data['mid']).toBe(mid);

      // Tag for cleanup
      await db.collection('contactKeys').doc(emailHash).set({ _test: true }, { merge: true });

      const phoneHash = hashContactKey('phone', PHONE);
      const phoneSnap = await db.collection('contactKeys').doc(phoneHash).get();
      if (phoneSnap.exists) {
        await db.collection('contactKeys').doc(phoneHash).set({ _test: true }, { merge: true });
      }
    });

    it('second registration with same email returns 409 duplicate-contact', async () => {
      const { POST } = await import('@/app/api/setu/register/route');
      // A fresh grant (the first was consumed); the route consumes it, then
      // registerFamily throws duplicate-contact → 409.
      const { issueRegistrationGrant } = await import('@/features/setu/registration/registration-grant');
      const registrationGrant = await issueRegistrationGrant(EMAIL);
      const body = {
        email: EMAIL,
        phone: `555${(Date.now() + 1).toString(36).replace(/[^0-9]/g, '0').slice(0, 7)}`,
        familyName: 'Duplicate Family',
        location: 'Brampton' as const,
        manager: { firstName: 'Dup', lastName: 'Manager', gender: 'PreferNotToSay' as const },
        additionalMembers: [],
        registrationGrant,
      };
      const req = new Request('http://localhost/api/setu/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const res = await POST(req);
      expect(res.status).toBe(409);
    });
  },
);
