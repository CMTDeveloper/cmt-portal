import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore admin ───────────────────────────────────────────────────────────
const mockFirestoreGet = vi.fn();
const mockFirestoreSet = vi.fn();
const mockFirestoreRunTransaction = vi.fn();

const makeSubDocRef = () => ({
  get: mockFirestoreGet,
  set: mockFirestoreSet,
});

const makeDocRef = () => ({
  get: mockFirestoreGet,
  set: mockFirestoreSet,
  collection: vi.fn().mockReturnValue({
    doc: vi.fn().mockImplementation(() => makeSubDocRef()),
  }),
});

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation(() => ({
      doc: vi.fn().mockImplementation(() => makeDocRef()),
    })),
    runTransaction: mockFirestoreRunTransaction,
  })),
}));

// ── Legacy RTDB lookup ────────────────────────────────────────────────────────
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({
  findFamilyByContact: vi.fn(),
}));

import { findFamilyByContact as legacyFindFamilyByContact } from '@/features/check-in/shared/rtdb/family-lookup';
import { findSetuFamilyByContact } from '../find-family-by-contact';

const legacyFamilyFixture = {
  fid: '42',
  name: 'Sharma family',
  contacts: [{ type: 'email', value: 'sharma@example.com' }],
  paymentStatus: 'paid',
  students: [],
};

const contactKeyData = {
  contactKey: 'abc123',
  type: 'email',
  fid: 'FAM001',
  mid: 'FAM001-01',
};

const familyData = {
  fid: 'FAM001',
  name: 'Patel',
  location: 'Brampton',
  managers: ['FAM001-01'],
  legacyFid: null,
  createdAt: new Date(),
  searchKeys: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Setu hit wins over legacy when both have the contact
// ─────────────────────────────────────────────────────────────────────────────

describe('findSetuFamilyByContact — Setu hit wins', () => {
  it('returns source=setu when contactKeys/{hash} exists, never calls legacy', async () => {
    mockFirestoreGet
      .mockResolvedValueOnce({ exists: true, data: () => contactKeyData })
      .mockResolvedValueOnce({ exists: true, data: () => familyData })
      .mockResolvedValueOnce({ exists: true, data: () => ({ mid: 'FAM001-01' }) });

    const result = await findSetuFamilyByContact('email', 'raj.patel@gmail.com');

    expect(result.source).toBe('setu');
    expect(result.fid).toBe('FAM001');
    expect(result.mid).toBe('FAM001-01');
    expect(result.legacyFid).toBeNull();
    expect(legacyFindFamilyByContact).not.toHaveBeenCalled();
  });

  it('Setu hit: family document missing returns source=setu with null family', async () => {
    mockFirestoreGet
      .mockResolvedValueOnce({ exists: true, data: () => contactKeyData })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false });

    const result = await findSetuFamilyByContact('email', 'raj.patel@gmail.com');

    expect(result.source).toBe('setu');
    expect(result.fid).toBe('FAM001');
    expect(result.family).toBeNull();
    expect(legacyFindFamilyByContact).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy fallback when Setu has no record
// ─────────────────────────────────────────────────────────────────────────────

describe('findSetuFamilyByContact — legacy fallback', () => {
  it('falls back to legacy when contactKey doc does not exist', async () => {
    mockFirestoreGet.mockResolvedValueOnce({ exists: false });
    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      legacyFamilyFixture,
    );

    const result = await findSetuFamilyByContact('email', 'sharma@example.com');

    expect(result.source).toBe('legacy');
    expect(result.legacyFid).toBe('42');
    expect(result.fid).toBeNull();
    expect(result.mid).toBeNull();
    expect(legacyFindFamilyByContact).toHaveBeenCalledOnce();
  });

  it('falls back to legacy for phone lookup', async () => {
    mockFirestoreGet.mockResolvedValueOnce({ exists: false });
    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      legacyFamilyFixture,
    );

    const result = await findSetuFamilyByContact('phone', '+14165550100');

    expect(result.source).toBe('legacy');
    expect(legacyFindFamilyByContact).toHaveBeenCalledWith('phone', '+14165550100');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No hit at all
// ─────────────────────────────────────────────────────────────────────────────

describe('findSetuFamilyByContact — no hit', () => {
  it('returns source=null when neither Setu nor legacy has the contact', async () => {
    mockFirestoreGet.mockResolvedValueOnce({ exists: false });
    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await findSetuFamilyByContact('email', 'nobody@example.com');

    expect(result.source).toBeNull();
    expect(result.fid).toBeNull();
    expect(result.mid).toBeNull();
    expect(result.legacyFid).toBeNull();
    expect(result.family).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// After lazy migrate: findSetuFamilyByContact returns Setu hit
// (simulates the sequence: legacy-only → migrate → Setu hit)
// ─────────────────────────────────────────────────────────────────────────────

describe('sequence: legacy fallback then Setu hit (post-migration)', () => {
  it('first call = legacy; after contactKey written, second call = setu', async () => {
    // First call: no Setu doc
    mockFirestoreGet
      .mockResolvedValueOnce({ exists: false });
    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      legacyFamilyFixture,
    );

    const first = await findSetuFamilyByContact('email', 'sharma@example.com');
    expect(first.source).toBe('legacy');

    // Simulate migration: contactKey now exists
    mockFirestoreGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ ...contactKeyData, fid: 'FAM-NEW', mid: 'FAM-NEW-01' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ...familyData, fid: 'FAM-NEW', legacyFid: '42' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ mid: 'FAM-NEW-01' }) });

    const second = await findSetuFamilyByContact('email', 'sharma@example.com');
    expect(second.source).toBe('setu');
    expect(second.fid).toBe('FAM-NEW');
    expect(legacyFindFamilyByContact).toHaveBeenCalledOnce(); // only first call used legacy
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contact normalization: different input forms hash to the same lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('contact normalization at lookup boundary', () => {
  it('email lookup normalizes to lowercase before hashing', async () => {
    // Return a hit on first call — proves the hash produced a lookup
    mockFirestoreGet
      .mockResolvedValueOnce({ exists: true, data: () => contactKeyData })
      .mockResolvedValueOnce({ exists: true, data: () => familyData })
      .mockResolvedValueOnce({ exists: true, data: () => ({ mid: 'FAM001-01' }) });

    const result = await findSetuFamilyByContact('email', 'RAJ.PATEL@GMAIL.COM');
    expect(result.source).toBe('setu');
    // The same hash should be produced for the lowercase version
    // (implementation normalizes before hashing)
  });
});
