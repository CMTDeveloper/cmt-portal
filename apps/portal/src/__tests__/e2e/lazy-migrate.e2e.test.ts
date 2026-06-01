/**
 * E2E: Lazy migration
 *
 * Tests the lazyMigrateLegacyFamily Firestore-write path by mocking
 * fetchLegacyFamilyForMigration with a synthetic legacy family. Does NOT read or
 * write RTDB (whose MASTER_FIREBASE_* creds point at prod).
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

// Mock fetchLegacyFamilyForMigration so we never read the real RTDB (whose
// MASTER_FIREBASE_* creds in .env.local point at prod). lazyMigrateLegacyFamily
// calls this to load the legacy family; mocking it exercises the full
// Firestore-write path against a synthetic family with zero prod access.
const mockFetchLegacy = vi.fn();
vi.mock('@/features/setu/registration/legacy-parser', () => ({
  fetchLegacyFamilyForMigration: mockFetchLegacy,
}));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const LEGACY_FID = `TEST-LEGACY-${Date.now().toString(36).toUpperCase()}`;

describe.skipIf(!hasUatCreds)(
  'E2E: lazyMigrateLegacyFamily — real UAT Firestore write path',
  () => {
    // NOTE: RTDB reads/writes are intentionally skipped. The MASTER_FIREBASE_*
    // creds in .env.local point at prod RTDB. We cannot safely touch prod there.
    // Instead we mock fetchLegacyFamilyForMigration to return a synthetic legacy
    // family and let lazyMigrateLegacyFamily exercise its full Firestore txn path.

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
      mockFetchLegacy.mockResolvedValue({
        legacyFid: LEGACY_FID,
        familyName: 'Legacy Test Family',
        location: 'Brampton',
        primaryFirstName: 'Parent',
        primaryLastName: 'Legacy',
        primaryEmail: LEGACY_CONTACT_EMAIL,
        primaryPhone: LEGACY_CONTACT_PHONE,
        adults: [
          {
            firstName: 'Parent',
            lastName: 'Legacy',
            gender: 'PreferNotToSay' as const,
            email: LEGACY_CONTACT_EMAIL,
            phone: LEGACY_CONTACT_PHONE,
            isPrimary: true,
          },
        ],
        children: [
          {
            firstName: 'StudentOne',
            lastName: 'Legacy',
            gender: 'Male' as const,
            schoolGrade: '4',
            legacySid: null,
          },
          {
            firstName: 'StudentTwo',
            lastName: 'Legacy',
            gender: 'Female' as const,
            schoolGrade: '7',
            legacySid: null,
          },
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

      mockFetchLegacy.mockResolvedValue({
        legacyFid: LEGACY_FID,
        familyName: 'Legacy Test Family',
        location: 'Brampton',
        primaryFirstName: 'Parent',
        primaryLastName: 'Legacy',
        primaryEmail: LEGACY_CONTACT_EMAIL,
        primaryPhone: LEGACY_CONTACT_PHONE,
        adults: [],
        children: [],
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
