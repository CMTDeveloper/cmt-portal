import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { searchFamilies } from '../search-families';

const mockFirestore = vi.mocked(portalFirestore);

type MockDocData = Record<string, unknown> | null;

interface MockDocSnap {
  exists: boolean;
  data: () => MockDocData;
}

interface MockQuerySnap {
  docs: Array<{ id: string; data: () => MockDocData }>;
}

function makeDocSnap(data: MockDocData): MockDocSnap {
  return { exists: data !== null, data: () => data };
}

function makeQuerySnap(docs: Array<{ id: string; data: MockDocData }>): MockQuerySnap {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

function makeDbWithQueryRouting(opts: {
  fidDoc?: { id: string; data: MockDocData };
  legacyFidDocs?: Array<{ id: string; data: MockDocData }>;
  searchKeysDocs?: Array<{ id: string; data: MockDocData }>;
  publicFidDocs?: Array<{ id: string; data: MockDocData }>;
  // members keyed by parent fid → list of member docs that match publicMid
  publicMidMembers?: Array<{ fid: string; mid: string; data: MockDocData }>;
  // family docs available for collectionGroup parent lookups (fid → data)
  familyDocsByFid?: Record<string, MockDocData>;
  contactKeyDoc?: MockDocData;
  contactKeyFamilyDoc?: MockDocData;
  memberCounts?: Record<string, number>;
}) {
  const memberCounts = opts.memberCounts ?? {};

  function makeMembersSubcollection(fid: string) {
    const count = memberCounts[fid] ?? 0;
    return {
      docs: Array.from({ length: count }, (_, i) => ({
        id: `${fid}-member-${i}`,
        data: () => ({ mid: `${fid}-member-${i}` }),
      })),
    };
  }

  function resolveFamilyDoc(id: string): MockDocData {
    if (opts.fidDoc && opts.fidDoc.id === id) {
      return opts.fidDoc.data;
    }
    if (
      opts.contactKeyDoc &&
      opts.contactKeyFamilyDoc &&
      (opts.contactKeyDoc as { fid?: string }).fid === id
    ) {
      return opts.contactKeyFamilyDoc;
    }
    if (opts.familyDocsByFid && id in opts.familyDocsByFid) {
      return opts.familyDocsByFid[id]!;
    }
    return null;
  }

  function makeFamilyDocRef(id: string) {
    return {
      id,
      get: vi.fn().mockResolvedValue(makeDocSnap(resolveFamilyDoc(id))),
      collection: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue(makeMembersSubcollection(id)),
        })),
      })),
    };
  }

  const db = {
    collection: vi.fn((col: string) => {
      if (col === 'contactKeys') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(makeDocSnap(opts.contactKeyDoc ?? null)),
          })),
        };
      }

      // col === 'families'
      return {
        doc: vi.fn((id: string) => makeFamilyDocRef(id)),
        where: vi.fn((field: string) => ({
          limit: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(
              field === 'legacyFid'
                ? makeQuerySnap(opts.legacyFidDocs ?? [])
                : field === 'publicFid'
                  ? makeQuerySnap(opts.publicFidDocs ?? [])
                  : makeQuerySnap(opts.searchKeysDocs ?? []),
            ),
          })),
        })),
      };
    }),
    collectionGroup: vi.fn((_col: string) => {
      // _col === 'members' — used for publicMid lookups
      return {
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              docs: (opts.publicMidMembers ?? []).map((m) => ({
                id: m.mid,
                data: () => m.data,
                ref: {
                  parent: {
                    // members subcollection → parent is the family doc
                    parent: makeFamilyDocRef(m.fid),
                  },
                },
              })),
            }),
          })),
        })),
      };
    }),
  };

  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchFamilies — empty/whitespace queries', () => {
  it('returns [] for empty string', async () => {
    mockFirestore.mockReturnValue(makeDbWithQueryRouting({}) as never);
    const result = await searchFamilies('');
    expect(result).toEqual([]);
  });

  it('returns [] for whitespace-only string', async () => {
    mockFirestore.mockReturnValue(makeDbWithQueryRouting({}) as never);
    const result = await searchFamilies('   ');
    expect(result).toEqual([]);
  });
});

describe('searchFamilies — email lookup', () => {
  it('finds family by email via contactKey', async () => {
    const contactKeyDoc = { contactKey: 'hash:email:test@example.com', type: 'email', fid: 'FAM-001' };
    const familyDoc = {
      fid: 'FAM-001',
      legacyFid: '4421',
      name: 'Patel Family',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-001-01'],
      searchKeys: ['patel family', 'FAM-001', '4421'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        contactKeyDoc,
        contactKeyFamilyDoc: familyDoc,
        memberCounts: { 'FAM-001': 3 },
      }) as never,
    );

    const result = await searchFamilies('test@example.com');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fid: 'FAM-001',
      legacyFid: '4421',
      name: 'Patel Family',
      location: 'Brampton',
      memberCount: 3,
    });
  });
});

describe('searchFamilies — phone lookup', () => {
  it('finds family by formatted phone via contactKey', async () => {
    const contactKeyDoc = { contactKey: 'hash:phone:(647) 123-4567', type: 'phone', fid: 'FAM-002' };
    const familyDoc = {
      fid: 'FAM-002',
      legacyFid: null,
      name: 'Sharma Family',
      location: 'Mississauga',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-002-01'],
      searchKeys: ['sharma family', 'FAM-002'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        contactKeyDoc,
        contactKeyFamilyDoc: familyDoc,
        memberCounts: { 'FAM-002': 2 },
      }) as never,
    );

    const result = await searchFamilies('(647) 123-4567');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fid: 'FAM-002',
      name: 'Sharma Family',
      memberCount: 2,
    });
  });
});

describe('searchFamilies — direct fid lookup', () => {
  it('finds family by exact fid', async () => {
    const familyDoc = {
      fid: 'FAM-001',
      legacyFid: '4421',
      name: 'Patel Family',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-001-01'],
      searchKeys: ['patel family', 'FAM-001', '4421'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        fidDoc: { id: 'FAM-001', data: familyDoc },
        memberCounts: { 'FAM-001': 4 },
      }) as never,
    );

    const result = await searchFamilies('FAM-001');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fid: 'FAM-001',
      legacyFid: '4421',
      memberCount: 4,
    });
  });
});

describe('searchFamilies — legacyFid lookup', () => {
  it('finds family by legacyFid via where query', async () => {
    const familyDoc = {
      fid: 'FAM-005',
      legacyFid: '4421',
      name: 'Gupta Family',
      location: 'Scarborough',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-005-01'],
      searchKeys: ['gupta family', 'FAM-005', '4421'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        legacyFidDocs: [{ id: 'FAM-005', data: familyDoc }],
        memberCounts: { 'FAM-005': 5 },
      }) as never,
    );

    const result = await searchFamilies('4421');
    expect(result.some((h) => h.fid === 'FAM-005')).toBe(true);
  });
});

describe('searchFamilies — name prefix lookup', () => {
  it('finds family by partial lowercase name via searchKeys', async () => {
    const familyDoc = {
      fid: 'FAM-010',
      legacyFid: '99',
      name: 'Patel Family',
      location: 'Markham',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-010-01'],
      searchKeys: ['patel', 'FAM-010', '99'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        searchKeysDocs: [{ id: 'FAM-010', data: familyDoc }],
        memberCounts: { 'FAM-010': 1 },
      }) as never,
    );

    const result = await searchFamilies('patel');
    expect(result.some((h) => h.fid === 'FAM-010')).toBe(true);
  });
});

describe('searchFamilies — publicFid lookup', () => {
  it('finds a family by its 4-digit publicFid', async () => {
    const familyDoc = {
      fid: 'CMT-X',
      legacyFid: null,
      name: 'Rao Family',
      location: 'Brampton',
      publicFid: '1042',
      createdAt: { toDate: () => new Date() },
      managers: ['CMT-X-01'],
      searchKeys: ['rao family', 'CMT-X'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        publicFidDocs: [{ id: 'CMT-X', data: familyDoc }],
        memberCounts: { 'CMT-X': 2 },
      }) as never,
    );

    const hits = await searchFamilies('1042');
    expect(hits.map((h) => h.fid)).toContain('CMT-X');
  });
});

describe('searchFamilies — publicMid lookup', () => {
  it('finds a family by a member 5-digit publicMid', async () => {
    const familyDoc = {
      fid: 'CMT-X',
      legacyFid: null,
      name: 'Rao Family',
      location: 'Brampton',
      publicFid: '1042',
      createdAt: { toDate: () => new Date() },
      managers: ['CMT-X-01'],
      searchKeys: ['rao family', 'CMT-X'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        publicMidMembers: [
          { fid: 'CMT-X', mid: 'CMT-X-02', data: { mid: 'CMT-X-02', publicMid: '50007' } },
        ],
        familyDocsByFid: { 'CMT-X': familyDoc },
        memberCounts: { 'CMT-X': 2 },
      }) as never,
    );

    const hits = await searchFamilies('50007');
    expect(hits.map((h) => h.fid)).toContain('CMT-X');
  });
});

describe('searchFamilies — deduplication', () => {
  it('dedupes by fid when multiple lookups return same family', async () => {
    const familyDoc = {
      fid: 'FAM-001',
      legacyFid: '4421',
      name: 'Patel Family',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-001-01'],
      searchKeys: ['patel', 'FAM-001', '4421'],
    };

    // Both direct fid lookup AND searchKeys return the same family
    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        fidDoc: { id: 'FAM-001', data: familyDoc },
        searchKeysDocs: [{ id: 'FAM-001', data: familyDoc }],
        legacyFidDocs: [{ id: 'FAM-001', data: familyDoc }],
        memberCounts: { 'FAM-001': 2 },
      }) as never,
    );

    const result = await searchFamilies('FAM-001');
    const fam001Hits = result.filter((h) => h.fid === 'FAM-001');
    expect(fam001Hits).toHaveLength(1);
  });
});

describe('searchFamilies — top 20 limit', () => {
  it('returns at most 20 results', async () => {
    const manyFamilies = Array.from({ length: 25 }, (_, i) => ({
      id: `FAM-${String(i).padStart(3, '0')}`,
      data: {
        fid: `FAM-${String(i).padStart(3, '0')}`,
        legacyFid: null,
        name: `Family ${i}`,
        location: 'Brampton',
        createdAt: { toDate: () => new Date() },
        managers: [`FAM-${String(i).padStart(3, '0')}-01`],
        searchKeys: ['family'],
      } as MockDocData,
    }));

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        searchKeysDocs: manyFamilies,
      }) as never,
    );

    const result = await searchFamilies('family');
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe('searchFamilies — no results', () => {
  it('returns [] for a non-existent query', async () => {
    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({}) as never,
    );

    const result = await searchFamilies('zzz-no-such-family-xyz');
    expect(result).toEqual([]);
  });
});

describe('searchFamilies — missing legacyFid', () => {
  it('returns null for legacyFid when field is null', async () => {
    const familyDoc = {
      fid: 'FAM-020',
      legacyFid: null,
      name: 'New Family',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-020-01'],
      searchKeys: ['new family', 'FAM-020'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        fidDoc: { id: 'FAM-020', data: familyDoc },
        memberCounts: { 'FAM-020': 0 },
      }) as never,
    );

    const result = await searchFamilies('FAM-020');
    expect(result).toHaveLength(1);
    expect(result[0]!.legacyFid).toBeNull();
  });
});

describe('searchFamilies — memberCount from subcollection', () => {
  it('counts members from the members subcollection', async () => {
    const familyDoc = {
      fid: 'FAM-030',
      legacyFid: null,
      name: 'Big Family',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['FAM-030-01'],
      searchKeys: ['big family', 'FAM-030'],
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        fidDoc: { id: 'FAM-030', data: familyDoc },
        memberCounts: { 'FAM-030': 7 },
      }) as never,
    );

    const result = await searchFamilies('FAM-030');
    expect(result).toHaveLength(1);
    expect(result[0]!.memberCount).toBe(7);
  });
});

describe('searchFamilies — missing fields fallback', () => {
  it('uses defaults when family doc is missing name/location', async () => {
    const familyDoc = {
      fid: 'FAM-040',
      // missing name, location, legacyFid
    };

    mockFirestore.mockReturnValue(
      makeDbWithQueryRouting({
        fidDoc: { id: 'FAM-040', data: familyDoc },
      }) as never,
    );

    const result = await searchFamilies('FAM-040');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('FAM-040');
    expect(result[0]!.location).toBe('Brampton');
    expect(result[0]!.legacyFid).toBeNull();
    expect(result[0]!.memberCount).toBe(0);
  });
});
