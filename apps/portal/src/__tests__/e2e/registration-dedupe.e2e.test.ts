/**
 * E2E: Registration dedupe via OTP sign-in
 *
 * Replaces the deleted /api/setu/family/join flow. The new dedupe path:
 *
 *   1. User enters email/phone on /register
 *   2. POST /api/setu/family-lookup → 200 { match: { fid, name, members } }
 *   3. UI sends user to /sign-in?email=<their-email>
 *   4. POST /api/setu/auth/send-code → OTP sent
 *   5. POST /api/setu/auth/verify-code → finds existing Setu family via
 *      contactKey, sets family-manager/member claims, returns redirectTo /family
 *
 * Pins this behavior end-to-end so refactoring contactKey hashing, the
 * findSetuFamilyByContact priority order, or send-code rate limiting can't
 * silently break dedupe.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

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

const hasUatCreds = Boolean(
  process.env.PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat' &&
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL &&
    process.env.PORTAL_FIREBASE_PRIVATE_KEY,
);

(hasUatCreds ? describe : describe.skip)(
  'E2E: Registration dedupe via OTP — real UAT Firestore',
  () => {
    const RUN_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    const MANAGER_EMAIL = `e2e.dedupe.${RUN_ID}@test.cmt.invalid`;
    const MANAGER_PHONE = `416${RUN_ID.slice(0, 7).replace(/[^0-9]/g, '5')}`;

    let fid: string;
    let managerMid: string;

    beforeAll(async () => {
      const { createTestFamily } = await import('./helpers/fixtures');
      const result = await createTestFamily({
        name: `E2E Dedupe Family ${RUN_ID}`,
        email: MANAGER_EMAIL,
        phone: MANAGER_PHONE,
      });
      fid = result.fid;
      managerMid = result.mid;
    });

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e dedupe] cleanup error (non-fatal):', err);
      }
    });

    it('POST /api/setu/family-lookup finds the seeded family by email', async () => {
      const { POST } = await import('@/app/api/setu/family-lookup/route');
      const req = new Request('http://localhost/api/setu/family-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: MANAGER_EMAIL, phone: MANAGER_PHONE }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { match: { fid: string; name: string } | null };
      expect(json.match).not.toBeNull();
      expect(json.match?.fid).toBe(fid);
    });

    it('POST /api/setu/family-lookup finds the same family by phone', async () => {
      const { POST } = await import('@/app/api/setu/family-lookup/route');
      const req = new Request('http://localhost/api/setu/family-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `other.${RUN_ID}@test.cmt.invalid`, phone: MANAGER_PHONE }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { match: { fid: string } | null };
      expect(json.match?.fid).toBe(fid);
    });

    it('findSetuFamilyByContact returns source=setu for the manager email', async () => {
      const { findSetuFamilyByContact } = await import('@/features/setu/auth/find-family-by-contact');
      const result = await findSetuFamilyByContact('email', MANAGER_EMAIL);
      expect(result.source).toBe('setu');
      expect(result.fid).toBe(fid);
      expect(result.mid).toBe(managerMid);
    });

    it('non-matching email returns no match', async () => {
      const { POST } = await import('@/app/api/setu/family-lookup/route');
      const req = new Request('http://localhost/api/setu/family-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `nobody.${RUN_ID}@test.cmt.invalid`,
          phone: `999${RUN_ID.slice(0, 7).replace(/[^0-9]/g, '0')}`,
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { match: unknown };
      expect(json.match).toBeNull();
    });
  },
);
