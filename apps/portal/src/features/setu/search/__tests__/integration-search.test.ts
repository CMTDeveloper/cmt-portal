import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── next/headers ──────────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
  headers: vi.fn(() => new Headers()),
}));

// ── hash-contact-key ──────────────────────────────────────────────────────────
// Deterministic fake: hash:<type>:<normalized>
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => {
    const normalized =
      type === 'email' ? value.trim().toLowerCase() : value.replace(/\D/g, '');
    return `hash:${type}:${normalized}`;
  },
}));

// ── server-only ───────────────────────────────────────────────────────────────
vi.mock('server-only', () => ({}));

// ── Firestore mock ────────────────────────────────────────────────────────────
//
// searchFamilies uses two access patterns:
//   1. db.collection(name).doc(id).get()            → direct doc fetch
//   2. db.collection(name).doc(id).collection(sub).limit(n).get() → member count
//   3. db.collection(name).where(...).limit(n).get() → query
//   4. db.collection('contactKeys').doc(hash).get()  → contactKey lookup
//
// We keep per-collection queues so tests can push snapshots in call order.

type DocSnap = { exists: boolean; data: () => Record<string, unknown> | undefined; id?: string };
type QuerySnap = { docs: Array<{ id: string; data: () => Record<string, unknown> }>; size?: number };

// Per-collection queues for doc gets and query gets
const docGetQueues = new Map<string, DocSnap[]>();
const queryGetQueues = new Map<string, QuerySnap[]>();
// Members subcollection snap queue (keyed just as 'members')
const membersGetQueue: QuerySnap[] = [];
// collectionGroup('members').where('publicMid', ...) results queue.
// Each entry yields member docs whose ref.parent.parent is the family doc {fid}.
const publicMidGroupQueue: Array<Array<{ fid: string; mid: string; data: Record<string, unknown> }>> = [];

function pushDocGet(collection: string, snap: DocSnap) {
  if (!docGetQueues.has(collection)) docGetQueues.set(collection, []);
  docGetQueues.get(collection)!.push(snap);
}

function pushQueryGet(collection: string, snap: QuerySnap) {
  if (!queryGetQueues.has(collection)) queryGetQueues.set(collection, []);
  queryGetQueues.get(collection)!.push(snap);
}

function shiftDocGet(collection: string): DocSnap {
  const q = docGetQueues.get(collection);
  if (q && q.length > 0) return q.shift()!;
  return { exists: false, data: () => undefined };
}

function shiftQueryGet(collection: string): QuerySnap {
  const q = queryGetQueues.get(collection);
  if (q && q.length > 0) return q.shift()!;
  return { docs: [], size: 0 };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation((colName: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => ({
        id: docId,
        get: vi.fn().mockImplementation(() => Promise.resolve(shiftDocGet(colName))),
        collection: vi.fn().mockImplementation((_sub: string) => ({
          // members subcollection
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockImplementation(() => {
            const snap = membersGetQueue.shift() ?? { docs: [], size: 0 };
            return Promise.resolve(snap);
          }),
        })),
      })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockImplementation(() => Promise.resolve(shiftQueryGet(colName))),
    })),
    // collectionGroup('members').where('publicMid', '==', q).limit(5).get()
    collectionGroup: vi.fn().mockImplementation((_group: string) => ({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockImplementation(() => {
        const rows = publicMidGroupQueue.shift() ?? [];
        return Promise.resolve({
          docs: rows.map((m) => ({
            id: m.mid,
            data: () => m.data,
            ref: {
              parent: {
                // members subcollection → parent is the family doc {fid}
                parent: {
                  id: m.fid,
                  get: vi.fn().mockImplementation(() =>
                    Promise.resolve({ exists: true, data: () => ({ fid: m.fid, ...m.data }) }),
                  ),
                },
              },
            },
          })),
        });
      }),
    })),
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    arrayUnion: vi.fn((...args: string[]) => ({ _union: args })),
    arrayRemove: vi.fn((...args: string[]) => ({ _remove: args })),
  },
}));

// ── Route handler (populated by worker #2) ────────────────────────────────────
import { GET } from '@/app/api/setu/family/search/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FID_A = 'FAMA0001ABCD';
const FID_B = 'FAMB0002WXYZ';

const FAMILY_A_DATA = {
  fid: FID_A,
  legacyFid: '4421',
  name: 'Patel Family',
  location: 'Brampton',
  createdAt: new Date('2026-01-01'),
  managers: [`${FID_A}-01`],
  searchKeys: ['patel', 'fam-001', '4421'],
};

const FAMILY_B_DATA = {
  fid: FID_B,
  legacyFid: '9900',
  name: 'Patel Brampton',
  location: 'Mississauga',
  createdAt: new Date('2026-01-02'),
  managers: [`${FID_B}-01`],
  searchKeys: ['patel', 'fam-002', '9900'],
};

function docSnap(data: Record<string, unknown>): DocSnap {
  return { exists: true, data: () => data, id: data['fid'] as string };
}

function notFound(): DocSnap {
  return { exists: false, data: () => undefined };
}

function querySnap(rows: Record<string, unknown>[]): QuerySnap {
  return {
    docs: rows.map((d) => ({ id: d['fid'] as string, data: () => d })),
    size: rows.length,
  };
}

function emptyQuery(): QuerySnap {
  return { docs: [], size: 0 };
}

function membersSnap(count: number): QuerySnap {
  return {
    docs: Array.from({ length: count }, (_, i) => ({
      id: `mid-0${i}`,
      data: () => ({}),
    })),
    size: count,
  };
}

// ── Request helpers ───────────────────────────────────────────────────────────

function makeGET(q: string, role = 'welcome-team'): Request {
  const url = `http://localhost/api/setu/family/search?q=${encodeURIComponent(q)}`;
  const hdrs: Record<string, string> = {};
  if (role) hdrs['x-portal-role'] = role;
  return new Request(url, { headers: hdrs });
}

beforeEach(() => {
  vi.clearAllMocks();
  docGetQueues.clear();
  queryGetQueues.clear();
  membersGetQueue.length = 0;
  publicMidGroupQueue.length = 0;
  flagsMock.setuAuth = true;
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Name search — "patel" matches searchKeys array-contains
// searchFamilies runs: doc(q).get() [miss], where(legacyFid).get() [empty],
//                      where(searchKeys).get() [hit family A]
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 1: name token search', () => {
  it('returns family A when searchKeys contains "patel"', async () => {
    // Direct fid lookup: no match (fid is not "patel")
    pushDocGet('families', notFound());
    // legacyFid query: no match
    pushQueryGet('families', emptyQuery());
    // searchKeys query: family A matches
    pushQueryGet('families', querySnap([FAMILY_A_DATA]));
    // member count for family A
    membersGetQueue.push(membersSnap(2));

    const res = await GET(makeGET('patel'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string; memberCount: number }> };
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]!.fid).toBe(FID_A);
    expect(body.hits[0]!.memberCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Direct fid lookup — exact fid match
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 2: direct fid search', () => {
  it('returns family A when fid matches exactly', async () => {
    // Direct doc(FID_A).get() → hit
    pushDocGet('families', docSnap(FAMILY_A_DATA));
    // legacyFid query: empty (dedup — already found)
    pushQueryGet('families', emptyQuery());
    // searchKeys query: empty
    pushQueryGet('families', emptyQuery());
    // member count
    membersGetQueue.push(membersSnap(3));

    const res = await GET(makeGET(FID_A));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits.some((h) => h.fid === FID_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Legacy fid lookup — "4421" → legacyFid query
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3: legacy fid search', () => {
  it('returns family A when legacyFid matches "4421"', async () => {
    // Direct doc("4421").get() → no match
    pushDocGet('families', notFound());
    // legacyFid == "4421" → family A
    pushQueryGet('families', querySnap([FAMILY_A_DATA]));
    // searchKeys query: empty
    pushQueryGet('families', emptyQuery());
    // member count
    membersGetQueue.push(membersSnap(4));

    const res = await GET(makeGET('4421'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits.some((h) => h.fid === FID_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3b: publicFid lookup — "1042" → where(publicFid) query
// Query order in non-contact branch: legacyFid, searchKeys, publicFid
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3b: publicFid search', () => {
  it('returns family A when publicFid matches "1042"', async () => {
    const familyWithPublicFid = { ...FAMILY_A_DATA, publicFid: '1042' };
    // Direct doc("1042").get() → no match
    pushDocGet('families', notFound());
    // legacyFid == "1042" → empty
    pushQueryGet('families', emptyQuery());
    // searchKeys → empty
    pushQueryGet('families', emptyQuery());
    // publicFid == "1042" → family A
    pushQueryGet('families', querySnap([familyWithPublicFid]));
    // member count
    membersGetQueue.push(membersSnap(2));

    const res = await GET(makeGET('1042'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits.some((h) => h.fid === FID_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3c: publicMid lookup — "50007" → collectionGroup(members).where(publicMid)
//              → ref.parent.parent (family) fetched
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3c: publicMid search', () => {
  it('returns family A when a member publicMid matches "50007"', async () => {
    // Direct doc("50007").get() → no match
    pushDocGet('families', notFound());
    // legacyFid → empty
    pushQueryGet('families', emptyQuery());
    // searchKeys → empty
    pushQueryGet('families', emptyQuery());
    // publicFid → empty
    pushQueryGet('families', emptyQuery());
    // collectionGroup members publicMid → one member under FID_A
    publicMidGroupQueue.push([{ fid: FID_A, mid: `${FID_A}-02`, data: { publicMid: '50007' } }]);
    // member count for the resolved family
    membersGetQueue.push(membersSnap(2));

    const res = await GET(makeGET('50007'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits.some((h) => h.fid === FID_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Email → contactKey hash → fid → family
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 4: email contact lookup', () => {
  it('returns family A when email resolves via contactKey', async () => {
    // contactKeys doc hit: hash:email:raj@patel.com → FID_A
    pushDocGet('contactKeys', {
      exists: true,
      data: () => ({ fid: FID_A, mid: `${FID_A}-01` }),
    });
    // families doc lookup after contactKey resolves
    pushDocGet('families', docSnap(FAMILY_A_DATA));
    // member count
    membersGetQueue.push(membersSnap(3));

    const res = await GET(makeGET('raj@patel.com'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits.some((h) => h.fid === FID_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Phone → normalize → contactKey → fid → family
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 5: phone contact lookup', () => {
  it('returns family A when phone resolves via contactKey', async () => {
    pushDocGet('contactKeys', {
      exists: true,
      data: () => ({ fid: FID_A, mid: `${FID_A}-01` }),
    });
    pushDocGet('families', docSnap(FAMILY_A_DATA));
    membersGetQueue.push(membersSnap(2));

    const res = await GET(makeGET('(647) 123-4567'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits.some((h) => h.fid === FID_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Dedupe — same fid appears in fid query and legacyFid query
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 6: dedupe — same family from multiple query paths', () => {
  it('returns only one hit when fid + legacyFid + searchKeys all resolve to FID_A', async () => {
    // Direct fid match
    pushDocGet('families', docSnap(FAMILY_A_DATA));
    // legacyFid also returns family A (same fid, dedup by Map key)
    pushQueryGet('families', querySnap([FAMILY_A_DATA]));
    // searchKeys also returns family A
    pushQueryGet('families', querySnap([FAMILY_A_DATA]));
    // Only one member count fetch (after dedup)
    membersGetQueue.push(membersSnap(2));

    const res = await GET(makeGET(FID_A));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    const fids = body.hits.map((h) => h.fid);
    const unique = new Set(fids);
    expect(unique.size).toBe(fids.length);
    expect(fids).toContain(FID_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: Two different families both matching name "patel" → both returned
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 7: two families matching name', () => {
  it('returns both families when searchKeys matches two families', async () => {
    // Direct fid("patel"): no match
    pushDocGet('families', notFound());
    // legacyFid: no match
    pushQueryGet('families', emptyQuery());
    // searchKeys returns both A and B
    pushQueryGet('families', querySnap([FAMILY_A_DATA, FAMILY_B_DATA]));
    // member counts for A then B
    membersGetQueue.push(membersSnap(3));
    membersGetQueue.push(membersSnap(1));

    const res = await GET(makeGET('patel'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string }> };
    expect(body.hits).toHaveLength(2);
    const fids = body.hits.map((h) => h.fid);
    expect(fids).toContain(FID_A);
    expect(fids).toContain(FID_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Empty query → 200 with hits: []
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 8: empty query', () => {
  it('returns 200 with empty hits for empty string', async () => {
    const res = await GET(makeGET(''));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9: Whitespace-only query → 200 with hits: []
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 9: whitespace query', () => {
  it('returns 200 with empty hits for whitespace-only query', async () => {
    const res = await GET(makeGET('   '));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10: Non-existent query → 200 with hits: []
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 10: non-existent query', () => {
  it('returns 200 with empty hits when nothing matches', async () => {
    pushDocGet('families', notFound());
    pushQueryGet('families', emptyQuery()); // legacyFid
    pushQueryGet('families', emptyQuery()); // searchKeys

    const res = await GET(makeGET('zzz-no-match'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 11: Role family-manager → 403
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 11: role enforcement — family-manager', () => {
  it('returns 403 when caller has role family-manager', async () => {
    const res = await GET(makeGET('patel', 'family-manager'));

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 12: Role family-member → 403
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 12: role enforcement — family-member', () => {
  it('returns 403 when caller has role family-member', async () => {
    const res = await GET(makeGET('patel', 'family-member'));

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 13: Role welcome-team → 200 with hits
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 13: role enforcement — welcome-team', () => {
  it('returns 200 when caller has role welcome-team', async () => {
    pushDocGet('families', notFound());
    pushQueryGet('families', emptyQuery());
    pushQueryGet('families', querySnap([FAMILY_A_DATA]));
    membersGetQueue.push(membersSnap(2));

    const res = await GET(makeGET('patel', 'welcome-team'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(Array.isArray(body.hits)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 14: Feature flag off → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 14: feature flag off', () => {
  it('returns 404 when setuAuth flag is false', async () => {
    flagsMock.setuAuth = false;

    const res = await GET(makeGET('patel', 'welcome-team'));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 15: memberCount from members subcollection
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 15: memberCount accuracy', () => {
  it('populates memberCount from the members subcollection size', async () => {
    pushDocGet('families', notFound());
    pushQueryGet('families', emptyQuery());
    pushQueryGet('families', querySnap([FAMILY_A_DATA]));
    membersGetQueue.push(membersSnap(5));

    const res = await GET(makeGET('patel', 'welcome-team'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: Array<{ fid: string; memberCount: number }> };
    const hit = body.hits.find((h) => h.fid === FID_A);
    expect(hit).toBeDefined();
    expect(hit!.memberCount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 16: No auth headers → 401
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 16: unauthenticated', () => {
  it('returns 401 when no x-portal-role header present', async () => {
    const req = new Request('http://localhost/api/setu/family/search?q=patel');

    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no-session');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 17: contactKey miss → 200 with empty hits
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 17: email with no contactKey match', () => {
  it('returns empty hits when contactKey doc does not exist', async () => {
    pushDocGet('contactKeys', notFound());

    const res = await GET(makeGET('ghost@example.com'));

    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });
});
