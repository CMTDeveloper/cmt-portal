import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: { fromDate: vi.fn((d: Date) => ({ _date: d })) },
}));
// Stable hash so we can predict contactKey doc ids in the mock graph.
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.toLowerCase().trim()}`,
}));

import { createJoinRequest } from '../create-request';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * Build a Firestore mock graph:
 *   contactKeys/{hash} -> { fid, mid }
 *   families/{fid} -> { name, managers: [...] }
 *   families/{fid}/members/{mid} -> member doc
 *   families/{fid}/joinRequests/{matchedMid} -> existing request doc (or none)
 *
 * I2: the request doc id is DETERMINISTIC (= matchedMid), so dedupe is a direct
 * doc read, not a query. `joinReqDocIds` records every doc id .set() targeted so
 * tests can assert the deterministic id.
 */
type Member = {
  portalAccess?: 'active' | 'pending';
  manager?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
};

type ExistingRequest = {
  token: string;
  status?: 'pending' | 'approved' | 'declined';
  expiresAt?: unknown;
};

function setupDb(opts: {
  contactKey?: { fid: string; mid: string } | null;
  family?: { name?: string; managers?: string[] } | null;
  members?: Record<string, Member>;
  // Existing joinRequests doc keyed by its deterministic id (= matchedMid).
  existingRequests?: Record<string, ExistingRequest>;
}) {
  const {
    contactKey = null,
    family = null,
    members = {},
    existingRequests = {},
  } = opts;

  const setSpy = vi.fn().mockResolvedValue(undefined);
  // Records the doc id each .set() targeted (asserts deterministic id = mid).
  const joinReqDocIds: string[] = [];

  // members getAll spy
  const getAll = vi.fn(async (...refs: Array<{ _mid: string }>) =>
    refs.map((r) => {
      const m = members[r._mid];
      return {
        exists: m !== undefined,
        data: () => m,
      };
    }),
  );

  function memberRef(fid: string, mid: string) {
    return {
      _mid: mid,
      get: vi.fn(async () => ({
        exists: members[mid] !== undefined,
        data: () => members[mid],
      })),
    };
  }

  function joinRequestsCollection() {
    return {
      doc: vi.fn((id: string) => ({
        // Direct dedupe read against the deterministic doc id.
        get: vi.fn(async () => {
          const existing = existingRequests[id];
          return {
            exists: existing !== undefined,
            data: () => existing,
          };
        }),
        set: vi.fn(async (data: unknown) => {
          joinReqDocIds.push(id);
          return setSpy(data);
        }),
      })),
    };
  }

  function familyDoc(fid: string) {
    return {
      get: vi.fn(async () => ({
        exists: family !== null,
        data: () => family ?? undefined,
      })),
      collection: vi.fn((name: string) => {
        if (name === 'members') {
          return { doc: vi.fn((mid: string) => memberRef(fid, mid)) };
        }
        if (name === 'joinRequests') {
          return joinRequestsCollection();
        }
        return { doc: vi.fn() };
      }),
    };
  }

  const db = {
    getAll,
    collection: vi.fn((name: string) => {
      if (name === 'contactKeys') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: contactKey !== null,
              data: () => contactKey ?? undefined,
            })),
          })),
        };
      }
      if (name === 'families') {
        return { doc: vi.fn((fid: string) => familyDoc(fid)) };
      }
      return { doc: vi.fn() };
    }),
  };

  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(db);
  return { setSpy, joinReqDocIds };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createJoinRequest', () => {
  it('noop when no contactKey hit (e.g. emergency contact / unknown)', async () => {
    const { setSpy } = setupDb({ contactKey: null });
    const res = await createJoinRequest({ type: 'email', value: 'nobody@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('noop');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('noop when matched member is already a manager', async () => {
    const { setSpy } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-01' },
      family: { name: 'Sharma', managers: ['F1-01'] },
      members: { 'F1-01': { manager: true, portalAccess: 'active' } },
    });
    const res = await createJoinRequest({ type: 'email', value: 'mgr@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('noop');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('noop when matched member is active/absent (not gated)', async () => {
    const { setSpy } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-02' },
      family: { name: 'Sharma', managers: ['F1-01'] },
      members: { 'F1-02': { manager: false } }, // portalAccess absent => active
    });
    const res = await createJoinRequest({ type: 'email', value: 'active@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('noop');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('creates a pending doc for a gated member and resolves manager targets', async () => {
    const { setSpy, joinReqDocIds } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-02' },
      family: { name: 'Sharma Family', managers: ['F1-01'] },
      members: {
        'F1-02': { manager: false, portalAccess: 'pending', firstName: 'Asha', lastName: 'Sharma', email: 'asha@example.com' },
        'F1-01': { manager: true, firstName: 'Raj', lastName: 'Sharma', email: 'raj@example.com', phone: '+14165551212' },
      },
    });
    const res = await createJoinRequest({ type: 'email', value: 'Asha@Example.com', ttlDays: 14 });
    expect(res.outcome).toBe('created');
    if (res.outcome === 'noop') throw new Error('unreachable');
    expect(res.fid).toBe('F1');
    expect(res.familyName).toBe('Sharma Family');
    expect(res.requesterEmail).toBe('asha@example.com');
    expect(res.managers).toHaveLength(1);
    expect(res.managers[0]!.email).toBe('raj@example.com');
    expect(res.managers[0]!.phone).toBe('+14165551212');
    // wrote the pending doc
    expect(setSpy).toHaveBeenCalledOnce();
    // I2: the request doc id is the DETERMINISTIC matchedMid (not the token).
    expect(joinReqDocIds).toEqual(['F1-02']);
    const docData = setSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(docData.status).toBe('pending');
    expect(docData.fid).toBe('F1');
    expect(docData.matchedMid).toBe('F1-02');
    expect(docData.requesterEmail).toBe('asha@example.com');
    // The token is still a RANDOM stored field (used for the email link +
    // collectionGroup get-by-token), distinct from the deterministic doc id.
    expect(typeof docData.token).toBe('string');
    expect((docData.token as string).length).toBeGreaterThanOrEqual(32);
    expect(docData.token).not.toBe('F1-02');
  });

  it('N=2 managers: BOTH managers end up in the returned notify targets', async () => {
    const { setSpy } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-03' },
      family: { name: 'Two Manager Family', managers: ['F1-01', 'F1-02'] },
      members: {
        'F1-03': { manager: false, portalAccess: 'pending', firstName: 'Asha', email: 'asha@example.com' },
        'F1-01': { manager: true, firstName: 'Raj', email: 'raj@example.com', phone: '+14165551212' },
        'F1-02': { manager: true, firstName: 'Mum', email: 'mum@example.com', phone: null },
      },
    });
    const res = await createJoinRequest({ type: 'email', value: 'asha@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('created');
    if (res.outcome === 'noop') throw new Error('unreachable');
    expect(res.managers).toHaveLength(2);
    const emails = res.managers.map((m) => m.email).sort();
    expect(emails).toEqual(['mum@example.com', 'raj@example.com']);
    expect(setSpy).toHaveBeenCalledOnce();
  });

  it('dedupes an existing OPEN (pending, unexpired) request (no new doc written)', async () => {
    const { setSpy } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-02' },
      family: { name: 'Sharma Family', managers: ['F1-01'] },
      members: {
        'F1-02': { manager: false, portalAccess: 'pending', email: 'asha@example.com' },
        'F1-01': { manager: true, email: 'raj@example.com' },
      },
      // Existing pending request at the deterministic doc id (= matchedMid),
      // unexpired (expiresAt in the future).
      existingRequests: {
        'F1-02': {
          token: 'existingTok',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86400_000),
        },
      },
    });
    const res = await createJoinRequest({ type: 'email', value: 'asha@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('deduped');
    if (res.outcome === 'noop') throw new Error('unreachable');
    expect(res.token).toBe('existingTok');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('OVERWRITES a previously declined request with a fresh pending one (re-request works)', async () => {
    const { setSpy, joinReqDocIds } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-02' },
      family: { name: 'Sharma Family', managers: ['F1-01'] },
      members: {
        'F1-02': { manager: false, portalAccess: 'pending', email: 'asha@example.com' },
        'F1-01': { manager: true, email: 'raj@example.com' },
      },
      existingRequests: {
        'F1-02': { token: 'oldDeclinedTok', status: 'declined' },
      },
    });
    const res = await createJoinRequest({ type: 'email', value: 'asha@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('created');
    if (res.outcome === 'noop') throw new Error('unreachable');
    // Overwrote the same deterministic doc id with a brand-new token.
    expect(joinReqDocIds).toEqual(['F1-02']);
    expect(res.token).not.toBe('oldDeclinedTok');
    expect(setSpy).toHaveBeenCalledOnce();
  });

  it('noop when family doc missing', async () => {
    const { setSpy } = setupDb({
      contactKey: { fid: 'F1', mid: 'F1-02' },
      family: null,
      members: { 'F1-02': { manager: false, portalAccess: 'pending' } },
    });
    const res = await createJoinRequest({ type: 'email', value: 'asha@example.com', ttlDays: 14 });
    expect(res.outcome).toBe('noop');
    expect(setSpy).not.toHaveBeenCalled();
  });
});
