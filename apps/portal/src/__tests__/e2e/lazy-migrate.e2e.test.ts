/**
 * E2E: Lazy migration
 *
 * Tests the lazyMigrateLegacyFamily Firestore-write path by mocking findFamilyById
 * with a synthetic legacy family. Does NOT write to RTDB (which could be prod).
 *
 * After migration, verifies:
 *   - families/{fid} doc exists with legacyFid set
 *   - members subcollection has manager placeholder + students
 *   - contactKeys exist for known legacy contacts
 *
 * Cleanup: all test docs carry `_test: true`. afterAll runs cleanupTestData().
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

const hasUatCreds =
  !!process.env['PORTAL_FIREBASE_PROJECT_ID'] &&
  !!process.env['PORTAL_FIREBASE_CLIENT_EMAIL'] &&
  !!process.env['PORTAL_FIREBASE_PRIVATE_KEY'];

// Mock findFamilyById so we never touch real RTDB (which may point to prod).
// This exercises the full Firestore-write path of lazyMigrateLegacyFamily.
const mockFindFamilyById = vi.fn();
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({
  findFamilyById: mockFindFamilyById,
}));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const LEGACY_FID = `TEST-LEGACY-${Date.now().toString(36).toUpperCase()}`;

describe.skipIf(!hasUatCreds)(
  'E2E: lazyMigrateLegacyFamily — real UAT Firestore write path',
  () => {
    // NOTE: RTDB writes are intentionally skipped. The MASTER_FIREBASE_* creds
    // in .env.local point at prod RTDB. We cannot safely write test rows there.
    // Instead we mock findFamilyById to return a synthetic legacy family and let
    // lazyMigrateLegacyFamily exercise its full Firestore transaction path.

    const LEGACY_CONTACT_EMAIL = `e2e.legacy.${LEGACY_FID.toLowerCase()}@test.cmt.invalid`;
    const LEGACY_CONTACT_PHONE = `905${LEGACY_FID.slice(0, 7).replace(/[^0-9]/g, '4')}`;

    let migratedFid: string;

    afterAll(async () => {
      const { cleanupTestData } = await import('./helpers/firestore');
      try {
        await cleanupTestData();
      } catch (err) {
        console.error('[e2e lazy-migrate] cleanup error (non-fatal):', err);
      }
    });

    it('lazyMigrateLegacyFamily creates Firestore family + members + contactKeys', async () => {
      mockFindFamilyById.mockResolvedValue({
        id: LEGACY_FID,
        name: 'Legacy Test Family',
        contacts: [
          { type: 'email' as const, value: LEGACY_CONTACT_EMAIL },
          { type: 'phone' as const, value: LEGACY_CONTACT_PHONE },
        ],
        students: [
          { firstName: 'StudentOne', lastName: 'Legacy', level: 'Grade 4' },
          { firstName: 'StudentTwo', lastName: 'Legacy', level: 'Grade 7' },
        ],
      });

      const { lazyMigrateLegacyFamily } = await import(
        '@/features/setu/registration/lazy-migrate'
      );

      const result = await lazyMigrateLegacyFamily(LEGACY_FID);
      expect(result.migrated).toBe(true);
      expect(result.legacyFid).toBe(LEGACY_FID);
      expect(typeof result.fid).toBe('string');
      migratedFid = result.fid;
    });

    it('families/{fid} doc exists with legacyFid set', async () => {
      expect(migratedFid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const snap = await db.collection('families').doc(migratedFid).get();
      expect(snap.exists).toBe(true);
      const data = snap.data() as Record<string, unknown>;
      expect(data['legacyFid']).toBe(LEGACY_FID);
      expect(data['name']).toBe('Legacy Test Family');

      // Tag for cleanup
      await snap.ref.set({ _test: true }, { merge: true });
    });

    it('members subcollection has manager placeholder + 2 students', async () => {
      expect(migratedFid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();

      const membersSnap = await db
        .collection('families')
        .doc(migratedFid)
        .collection('members')
        .get();

      expect(membersSnap.size).toBe(3); // 1 manager placeholder + 2 students

      const members = membersSnap.docs.map((d) => d.data() as Record<string, unknown>);

      // Tag all members for cleanup
      for (const doc of membersSnap.docs) {
        await doc.ref.set({ _test: true }, { merge: true });
      }

      const manager = members.find((m) => m['manager'] === true);
      expect(manager).toBeTruthy();
      expect(manager!['type']).toBe('Adult');

      const students = members.filter((m) => m['manager'] === false);
      expect(students).toHaveLength(2);
      const studentNames = students.map((s) => s['firstName']);
      expect(studentNames).toContain('StudentOne');
      expect(studentNames).toContain('StudentTwo');
    });

    it('contactKeys exist for email + phone contacts', async () => {
      expect(migratedFid).toBeTruthy();
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
      const db = portalFirestore();

      const emailHash = hashContactKey('email', LEGACY_CONTACT_EMAIL);
      const phoneHash = hashContactKey('phone', LEGACY_CONTACT_PHONE);

      const [emailSnap, phoneSnap] = await Promise.all([
        db.collection('contactKeys').doc(emailHash).get(),
        db.collection('contactKeys').doc(phoneHash).get(),
      ]);

      expect(emailSnap.exists).toBe(true);
      const emailData = emailSnap.data() as Record<string, unknown>;
      expect(emailData['fid']).toBe(migratedFid);

      expect(phoneSnap.exists).toBe(true);
      const phoneData = phoneSnap.data() as Record<string, unknown>;
      expect(phoneData['fid']).toBe(migratedFid);

      // Tag for cleanup
      await emailSnap.ref.set({ _test: true }, { merge: true });
      await phoneSnap.ref.set({ _test: true }, { merge: true });
    });

    it('second call with same legacyFid returns migrated: false (idempotent)', async () => {
      expect(migratedFid).toBeTruthy();

      mockFindFamilyById.mockResolvedValue({
        id: LEGACY_FID,
        name: 'Legacy Test Family',
        contacts: [],
        students: [],
      });

      const { lazyMigrateLegacyFamily } = await import(
        '@/features/setu/registration/lazy-migrate'
      );

      const result = await lazyMigrateLegacyFamily(LEGACY_FID);
      expect(result.migrated).toBe(false);
      expect(result.fid).toBe(migratedFid);
    });
  },
);
