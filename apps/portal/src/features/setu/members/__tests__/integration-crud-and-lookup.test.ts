import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore ─────────────────────────────────────────────────────────────────
const mockFirestoreGet = vi.fn();
const mockFirestoreSet = vi.fn();
const mockFirestoreDelete = vi.fn();
const mockFirestoreUpdate = vi.fn();
const mockCollectionGet = vi.fn();
const mockRunTransaction = vi.fn();

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation((_name: string) => ({
      doc: vi.fn().mockImplementation((_id?: string) => ({
        id: _id ?? 'auto-id',
        get: mockFirestoreGet,
        set: mockFirestoreSet,
        delete: mockFirestoreDelete,
        update: mockFirestoreUpdate,
        collection: vi.fn().mockImplementation((_sub: string) => ({
          doc: vi.fn().mockReturnValue({
            id: 'sub-id',
            get: mockFirestoreGet,
            set: mockFirestoreSet,
            delete: mockFirestoreDelete,
          }),
          get: mockCollectionGet,
          orderBy: vi.fn().mockReturnThis(),
        })),
      })),
      get: mockCollectionGet,
      where: vi.fn().mockReturnThis(),
    })),
    runTransaction: mockRunTransaction,
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    arrayUnion: vi.fn((...args: string[]) => ({ _union: args })),
    arrayRemove: vi.fn((...args: string[]) => ({ _remove: args })),
  },
}));

// ── normalizeContact / sha256Hex ──────────────────────────────────────────────
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.trim().toLowerCase() : v.replace(/\D/g, ''),
  sha256Hex: (s: string) => `sha256:${s}`,
}));

// ── Legacy family lookup (not used in Setu paths; returns null) ──────────────
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({
  findFamilyByContact: vi.fn().mockResolvedValue(null),
}));

// ── normalizeContact for find-family-by-contact ───────────────────────────────
vi.mock('@/features/check-in/shared/contact/normalize', () => ({
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.trim().toLowerCase() : v.replace(/\D/g, ''),
}));

import { assertNotLastManager, LastManagerError } from '../last-manager-guard';
import { findSetuFamilyByContact } from '../../auth/find-family-by-contact';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAMILY_A = {
  fid: 'FAMA0001ABCD',
  name: 'Patel',
  location: 'Brampton',
  managers: ['FAMA0001ABCD-01'],
};

const MEMBER_01 = {
  mid: 'FAMA0001ABCD-01',
  uid: 'uid-raj',
  firstName: 'Raj',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Male',
  manager: true,
  email: 'raj@example.com',
};

const MEMBER_02 = {
  mid: 'FAMA0001ABCD-02',
  uid: null,
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Female',
  manager: false,
  email: 'priya@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// findSetuFamilyByContact: post-member-add and post-member-delete behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('findSetuFamilyByContact: Setu contactKey lookup', () => {
  it('resolves to the correct fid and mid after a member with email is added', async () => {
    // Simulate contactKeys/{hash} doc existing after POST /api/setu/members
    mockFirestoreGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          contactKey: 'sha256:priya@example.com',
          type: 'email',
          fid: FAMILY_A.fid,
          mid: MEMBER_02.mid,
        }),
      })
      .mockResolvedValueOnce({ exists: true, data: () => FAMILY_A })
      .mockResolvedValueOnce({ exists: true, data: () => MEMBER_02 });

    const result = await findSetuFamilyByContact('email', 'priya@example.com');

    expect(result.source).toBe('setu');
    expect(result.fid).toBe(FAMILY_A.fid);
    expect(result.mid).toBe(MEMBER_02.mid);
    expect(result.family).toMatchObject({ name: 'Patel' });
  });

  it('returns null source after member is deleted (contactKey doc removed)', async () => {
    // contactKeys doc deleted after DELETE /api/setu/members/:mid
    mockFirestoreGet.mockResolvedValueOnce({ exists: false });
    // legacy fallback also returns nothing
    // (mock already returns null via vi.fn().mockResolvedValue(null))

    const result = await findSetuFamilyByContact('email', 'priya@example.com');

    expect(result.source).toBeNull();
    expect(result.fid).toBeNull();
    expect(result.mid).toBeNull();
  });

  it('falls back to legacy when no Setu contactKey exists', async () => {
    // No Setu hit
    mockFirestoreGet.mockResolvedValueOnce({ exists: false });

    const result = await findSetuFamilyByContact('email', 'unknown@example.com');

    // Legacy mock returns null too, so source should be null
    expect(result.source).toBeNull();
  });

  it('normalizes email case before hashing (case-insensitive)', async () => {
    mockFirestoreGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          contactKey: 'sha256:raj@example.com',
          type: 'email',
          fid: FAMILY_A.fid,
          mid: MEMBER_01.mid,
        }),
      })
      .mockResolvedValueOnce({ exists: true, data: () => FAMILY_A })
      .mockResolvedValueOnce({ exists: true, data: () => MEMBER_01 });

    const result = await findSetuFamilyByContact('email', 'RAJ@EXAMPLE.COM');

    expect(result.source).toBe('setu');
    expect(result.mid).toBe(MEMBER_01.mid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertNotLastManager: last-manager guard via PATCH
// ─────────────────────────────────────────────────────────────────────────────

describe('last-manager-guard: refuse to demote the only manager', () => {
  it('throws LastManagerError when demoting the only manager', () => {
    const family = { managers: [MEMBER_01.mid] };
    expect(() => assertNotLastManager(family, MEMBER_01.mid, 'demote')).toThrow(LastManagerError);
    expect(() => assertNotLastManager(family, MEMBER_01.mid, 'demote')).toThrow(
      'Cannot demote the last manager',
    );
  });

  it('allows demoting when a second manager exists', () => {
    const family = { managers: [MEMBER_01.mid, MEMBER_02.mid] };
    expect(() => assertNotLastManager(family, MEMBER_01.mid, 'demote')).not.toThrow();
  });

  it('throws LastManagerError when removing the only manager', () => {
    const family = { managers: [MEMBER_01.mid] };
    expect(() => assertNotLastManager(family, MEMBER_01.mid, 'remove')).toThrow(LastManagerError);
  });

  it('allows removing a non-manager member even if only one manager exists', () => {
    const family = { managers: [MEMBER_01.mid] };
    expect(() => assertNotLastManager(family, MEMBER_02.mid, 'remove')).not.toThrow();
  });

  it('allows removing one of two managers', () => {
    const family = { managers: [MEMBER_01.mid, MEMBER_02.mid] };
    expect(() => assertNotLastManager(family, MEMBER_01.mid, 'remove')).not.toThrow();
  });

  it('LastManagerError name is set correctly', () => {
    try {
      assertNotLastManager({ managers: [MEMBER_01.mid] }, MEMBER_01.mid, 'remove');
    } catch (e) {
      expect((e as Error).name).toBe('LastManagerError');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH manager demotion blocked through the guard
// ─────────────────────────────────────────────────────────────────────────────

describe('last-manager-guard: PATCH manager=false on only manager', () => {
  it('guard prevents setting manager=false when only one manager remains', () => {
    const family = { managers: [MEMBER_01.mid] };

    // Simulate what PATCH route does before writing: check if update demotes last manager
    const requestedManagerValue = false;
    const isRemovingManagerRole =
      typeof requestedManagerValue === 'boolean' && !requestedManagerValue;

    if (isRemovingManagerRole) {
      expect(() => assertNotLastManager(family, MEMBER_01.mid, 'demote')).toThrow(LastManagerError);
    }
  });

  it('guard allows PATCH manager=false when two managers exist', () => {
    const twoManagerFamily = { managers: [MEMBER_01.mid, MEMBER_02.mid] };
    expect(() => assertNotLastManager(twoManagerFamily, MEMBER_01.mid, 'demote')).not.toThrow();
  });
});
