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
