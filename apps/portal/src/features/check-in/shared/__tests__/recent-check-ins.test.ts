import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeGet = vi.fn();
const fakeLimit = vi.fn().mockReturnValue({ get: fakeGet });
const fakeOrderBy = vi.fn().mockReturnValue({ limit: fakeLimit });
const fakeWhere = vi.fn().mockReturnValue({ orderBy: fakeOrderBy });
const fakeCollection = vi.fn().mockReturnValue({ where: fakeWhere });

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: fakeCollection })),
}));

import { loadRecentFamilyCheckIns } from '../firestore/recent-check-ins';

const baseFamily = {
  fid: 'f1',
  name: 'Test Family',
  paymentStatus: 'paid' as const,
  contacts: [],
  students: [
    { sid: 's1', fid: 'f1', firstName: 'Alice', lastName: 'A', level: 'K' },
    { sid: 's2', fid: 'f1', firstName: 'Bob', lastName: 'B', level: '1' },
  ],
};

function makeDoc(id: string, sid: string, checkedInAt: string) {
  return {
    id,
    data: () => ({
      sid,
      status: 'present' as const,
      checkedInAt,
      checkedInBy: 'family' as const,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeLimit.mockReturnValue({ get: fakeGet });
  fakeOrderBy.mockReturnValue({ limit: fakeLimit });
  fakeWhere.mockReturnValue({ orderBy: fakeOrderBy });
  fakeCollection.mockReturnValue({ where: fakeWhere });
});

describe('loadRecentFamilyCheckIns', () => {
  it('passes the where fid filter through to Firestore', async () => {
    fakeGet.mockResolvedValueOnce({ docs: [] });
    await loadRecentFamilyCheckIns(baseFamily);
    expect(fakeWhere).toHaveBeenCalledWith('fid', '==', 'f1');
  });

  it('applies orderBy checkedInAt desc and default limit 10', async () => {
    fakeGet.mockResolvedValueOnce({ docs: [] });
    await loadRecentFamilyCheckIns(baseFamily);
    expect(fakeOrderBy).toHaveBeenCalledWith('checkedInAt', 'desc');
    expect(fakeLimit).toHaveBeenCalledWith(10);
  });

  it('applies a custom limit parameter', async () => {
    fakeGet.mockResolvedValueOnce({ docs: [] });
    await loadRecentFamilyCheckIns(baseFamily, 5);
    expect(fakeLimit).toHaveBeenCalledWith(5);
  });

  it('returns empty array when no events exist', async () => {
    fakeGet.mockResolvedValueOnce({ docs: [] });
    const result = await loadRecentFamilyCheckIns(baseFamily);
    expect(result).toEqual([]);
  });

  it('maps docs to CheckInHistoryEntry with correct fields', async () => {
    fakeGet.mockResolvedValueOnce({
      docs: [makeDoc('ci1', 's1', '2026-04-12T14:00:00Z')],
    });
    const result = await loadRecentFamilyCheckIns(baseFamily);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      checkInId: 'ci1',
      sid: 's1',
      firstName: 'Alice',
      lastName: 'A',
      status: 'present',
      checkedInAt: '2026-04-12T14:00:00Z',
      checkedInBy: 'family',
    });
  });

  it('falls back to "Unknown" firstName when sid is not in family students map', async () => {
    fakeGet.mockResolvedValueOnce({
      docs: [makeDoc('ci-orphan', 'unknown-sid', '2026-04-12T14:00:00Z')],
    });
    const result = await loadRecentFamilyCheckIns(baseFamily);
    expect(result[0]?.firstName).toBe('Unknown');
    expect(result[0]?.lastName).toBe('');
  });

  it('returns entries in the order Firestore provides (pre-sorted by index)', async () => {
    fakeGet.mockResolvedValueOnce({
      docs: [
        makeDoc('ci-new', 's1', '2026-04-12T14:00:00Z'),
        makeDoc('ci-old', 's2', '2026-04-10T14:00:00Z'),
      ],
    });
    const result = await loadRecentFamilyCheckIns(baseFamily);
    expect(result[0]?.checkInId).toBe('ci-new');
    expect(result[1]?.checkInId).toBe('ci-old');
  });
});
