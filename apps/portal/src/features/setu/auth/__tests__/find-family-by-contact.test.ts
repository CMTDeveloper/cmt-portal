import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({
  findFamilyByContact: vi.fn(),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyByContact as legacyFindFamilyByContact } from '@/features/check-in/shared/rtdb/family-lookup';
import { findSetuFamilyByContact } from '../find-family-by-contact';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findSetuFamilyByContact — Setu hit', () => {
  it('returns source=setu when contactKeys/{hash} exists', async () => {
    const contactKeyData = { contactKey: 'abc123', type: 'email', fid: 'FAM001', mid: 'FAM001-01' };
    const familyData = { fid: 'FAM001', name: 'Patel', location: 'Brampton', managers: ['FAM001-01'], legacyFid: null, createdAt: new Date(), searchKeys: [] };
    const memberData = { mid: 'FAM001-01', uid: null, firstName: 'Raj', lastName: 'Patel', type: 'Adult', gender: 'Male', manager: true };

    // We can't easily key by hashed path, so just use sequential mocks
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ exists: true, data: () => contactKeyData })
      .mockResolvedValueOnce({ exists: true, data: () => familyData })
      .mockResolvedValueOnce({ exists: true, data: () => memberData });

    (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: mockGet,
          collection: vi.fn().mockReturnValue({
            doc: vi.fn().mockReturnValue({ get: mockGet }),
          }),
        }),
      }),
    });

    const result = await findSetuFamilyByContact('email', 'raj.patel@gmail.com');
    expect(result.source).toBe('setu');
    expect(result.family).toMatchObject({ fid: 'FAM001' });
    expect(result.member).toMatchObject({ mid: 'FAM001-01' });
    expect(legacyFindFamilyByContact).not.toHaveBeenCalled();
  });
});

describe('findSetuFamilyByContact — legacy fallback', () => {
  it('falls back to legacy findFamilyByContact when no Setu hit', async () => {
    const mockGet = vi.fn().mockResolvedValueOnce({ exists: false });

    (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({ get: mockGet }),
      }),
    });

    const legacyFamily = { fid: '42', name: 'Sharma family', contacts: [], paymentStatus: 'paid', students: [] };
    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(legacyFamily);

    const result = await findSetuFamilyByContact('email', 'sharma@example.com');
    expect(result.source).toBe('legacy');
    expect(result.legacyFid).toBe('42');
    expect(result.family).toMatchObject({ fid: '42' });
  });
});

describe('findSetuFamilyByContact — no hit', () => {
  it('returns source=null when neither Setu nor legacy finds anything', async () => {
    const mockGet = vi.fn().mockResolvedValueOnce({ exists: false });

    (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({ get: mockGet }),
      }),
    });

    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await findSetuFamilyByContact('email', 'nobody@example.com');
    expect(result.source).toBeNull();
    expect(result.family).toBeNull();
    expect(result.member).toBeUndefined();
  });
});

describe('findSetuFamilyByContact — hash unification (regression)', () => {
  // Regression test for commit 9d4fbb5. findSetuFamilyByContact used to compute
  // its own sha256(normalized) without the `${type}:` prefix that hashContactKey
  // uses on every WRITER (register-family, lazy-migrate, accept-invite,
  // members CRUD). The mismatched hash meant the lookup always missed Setu
  // docs and silently fell back to the legacy RTDB. This test pins the
  // lookup-doc-id to the same helper every writer uses so the mismatch
  // can't come back.
  it('looks up contactKeys/{hashContactKey(type, value)} — same doc id used by all writers', async () => {
    const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
    const expectedHash = hashContactKey('email', 'raj.patel@gmail.com');

    const docFn = vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValueOnce({ exists: false }),
    });
    const collectionFn = vi.fn().mockReturnValue({ doc: docFn });

    (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
      collection: collectionFn,
    });
    (legacyFindFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    await findSetuFamilyByContact('email', 'raj.patel@gmail.com');

    expect(collectionFn).toHaveBeenCalledWith('contactKeys');
    // The exact hash must be the one hashContactKey produces — NOT a separate
    // sha256(normalized) without the type prefix.
    expect(docFn).toHaveBeenCalledWith(expectedHash);
  });

  it('hash for the same email matches what hashContactKey computes (round-trip)', async () => {
    const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
    // sha256("email:raj.patel@gmail.com") prefixed form — confirm it differs
    // from the un-prefixed legacy hash so this test fails loudly if the
    // prefix is removed.
    const prefixed = hashContactKey('email', 'raj.patel@gmail.com');
    const { createHash } = await import('node:crypto');
    const unprefixed = createHash('sha256').update('raj.patel@gmail.com').digest('hex');
    expect(prefixed).not.toBe(unprefixed);
    expect(prefixed.length).toBe(64); // sha256 hex = 64 chars
  });
});
