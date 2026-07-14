import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/setu/search/search-families', () => ({
  searchFamilies: vi.fn(),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { searchFamilies } from '@/features/setu/search/search-families';
import { searchTeachers } from '../search-teachers';

const mockFirestore = vi.mocked(portalFirestore);
const mockSearchFamilies = vi.mocked(searchFamilies);

type MemberData = Record<string, unknown>;

/**
 * Builds a mock Firestore whose families/{fid}/members subcollection returns the
 * supplied member docs. `membersByFid` maps a fid → the list of member docs the
 * `.collection('members').get()` call should yield for that family.
 */
function makeDb(membersByFid: Record<string, MemberData[]>) {
  return {
    collection: vi.fn((col: string) => {
      if (col !== 'families') throw new Error(`unexpected collection ${col}`);
      return {
        doc: vi.fn((fid: string) => ({
          collection: vi.fn((sub: string) => {
            if (sub !== 'members') throw new Error(`unexpected subcollection ${sub}`);
            return {
              get: vi.fn().mockResolvedValue({
                docs: (membersByFid[fid] ?? []).map((data) => ({ data: () => data })),
              }),
            };
          }),
        })),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchTeachers — empty query', () => {
  it('returns [] for an empty string without touching Firestore', async () => {
    mockFirestore.mockReturnValue(makeDb({}) as never);
    const result = await searchTeachers('');
    expect(result).toEqual([]);
    expect(mockSearchFamilies).not.toHaveBeenCalled();
  });

  it('returns [] for a whitespace-only query', async () => {
    mockFirestore.mockReturnValue(makeDb({}) as never);
    const result = await searchTeachers('   ');
    expect(result).toEqual([]);
    expect(mockSearchFamilies).not.toHaveBeenCalled();
  });
});

describe('searchTeachers — surfaces adult members of matched families', () => {
  it('returns the two adults (child excluded) each with {mid,name,email,fid,location}', async () => {
    mockSearchFamilies.mockResolvedValue([
      {
        fid: 'FAM-SH',
        publicFid: null,
        legacyFid: null,
        name: 'Sharma Family',
        parentName: 'Anil Sharma',
        location: 'Brampton',
        memberCount: 3,
      },
    ]);
    mockFirestore.mockReturnValue(
      makeDb({
        'FAM-SH': [
          {
            mid: 'FAM-SH-01',
            type: 'Adult',
            firstName: 'Anil',
            lastName: 'Sharma',
            email: 'anil@example.com',
          },
          // Second adult has NO email — must surface with email: null.
          { mid: 'FAM-SH-02', type: 'Adult', firstName: 'Priya', lastName: 'Sharma', email: null },
          // Child must be excluded.
          { mid: 'FAM-SH-03', type: 'Child', firstName: 'Rohan', lastName: 'Sharma', email: null },
        ],
      }) as never,
    );

    const hits = await searchTeachers('Sharma');

    expect(mockSearchFamilies).toHaveBeenCalledWith('Sharma');
    expect(hits).toEqual([
      {
        mid: 'FAM-SH-01',
        name: 'Anil Sharma',
        email: 'anil@example.com',
        fid: 'FAM-SH',
        location: 'Brampton',
      },
      {
        mid: 'FAM-SH-02',
        name: 'Priya Sharma',
        email: null,
        fid: 'FAM-SH',
        location: 'Brampton',
      },
    ]);
    // child excluded
    expect(hits.some((h) => h.mid === 'FAM-SH-03')).toBe(false);
  });

  it('dedupes an adult mid that appears across two matched families', async () => {
    mockSearchFamilies.mockResolvedValue([
      { fid: 'FAM-A', publicFid: null, legacyFid: null, name: 'A Family', parentName: 'Adult A', location: 'Brampton', memberCount: 1 },
      { fid: 'FAM-B', publicFid: null, legacyFid: null, name: 'B Family', parentName: 'Adult B', location: 'Mississauga', memberCount: 1 },
    ]);
    const dupAdult = { mid: 'DUP-01', type: 'Adult', firstName: 'Dup', lastName: 'Person', email: null };
    mockFirestore.mockReturnValue(
      makeDb({ 'FAM-A': [dupAdult], 'FAM-B': [dupAdult] }) as never,
    );

    const hits = await searchTeachers('dup');
    expect(hits.filter((h) => h.mid === 'DUP-01')).toHaveLength(1);
  });
});

describe('searchTeachers — no matched families', () => {
  it('returns [] when searchFamilies finds nothing', async () => {
    mockSearchFamilies.mockResolvedValue([]);
    mockFirestore.mockReturnValue(makeDb({}) as never);

    const hits = await searchTeachers('zzz-no-such-teacher');
    expect(hits).toEqual([]);
  });
});
