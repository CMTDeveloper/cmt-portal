import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: vi.fn((...vals: unknown[]) => ({ _arrayUnion: vals })),
  },
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.toLowerCase().trim()}`,
}));

import { approveJoinRequest } from '../approve-request';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

type Req = {
  matchedMid?: string;
  status?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  expiresAt?: unknown;
};

function setupDb(opts: {
  reqFid?: string | null; // parent fid of the request doc (null => query empty)
  request?: Req;
  member?: { email?: string | null; phone?: string | null } | null;
  existingContactKey?: { fid: string } | null;
}) {
  const { reqFid = 'F1', request = {}, member = { email: 'asha@example.com' }, existingContactKey = null } = opts;

  const updates: Array<{ target: string; data: Record<string, unknown> }> = [];
  const sets: Array<{ target: string; data: Record<string, unknown> }> = [];

  const reqRef = {
    parent: { parent: reqFid ? { id: reqFid } : null },
    _kind: 'request',
  };

  const txn = {
    get: vi.fn(async (ref: { _kind: string }) => {
      if (ref._kind === 'request') {
        return { exists: true, data: () => request };
      }
      if (ref._kind === 'member') {
        return { exists: member !== null, data: () => member ?? undefined };
      }
      if (ref._kind === 'contactKey') {
        return { exists: existingContactKey !== null, data: () => existingContactKey ?? undefined };
      }
      return { exists: false, data: () => undefined };
    }),
    update: vi.fn((ref: { _kind: string }, data: Record<string, unknown>) => {
      updates.push({ target: ref._kind, data });
    }),
    set: vi.fn((ref: { _kind: string }, data: Record<string, unknown>) => {
      sets.push({ target: ref._kind, data });
    }),
  };

  const db = {
    collectionGroup: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({
            empty: reqFid === null,
            docs: reqFid === null ? [] : [{ ref: reqRef }],
          })),
        })),
      })),
    })),
    collection: vi.fn((name: string) => {
      if (name === 'families') {
        return {
          doc: vi.fn(() => ({
            _kind: 'family',
            collection: vi.fn(() => ({ doc: vi.fn(() => ({ _kind: 'member' })) })),
          })),
        };
      }
      if (name === 'contactKeys') {
        return { doc: vi.fn(() => ({ _kind: 'contactKey' })) };
      }
      return { doc: vi.fn() };
    }),
    runTransaction: vi.fn(async (fn: (t: typeof txn) => unknown) => fn(txn)),
  };

  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(db);
  return { txn, updates, sets };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approveJoinRequest', () => {
  it('promotes the matched member + arrayUnion managers + sets active + theft-checks + marks approved', async () => {
    const { updates, sets } = setupDb({
      reqFid: 'F1',
      request: { matchedMid: 'F1-02', status: 'pending', requesterEmail: 'asha@example.com', expiresAt: new Date(Date.now() + 86400_000) },
      member: { email: 'asha@example.com' },
      existingContactKey: { fid: 'F1' }, // same family => no conflict
    });

    const res = await approveJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ ok: true, matchedMid: 'F1-02' });

    // member promotion
    const memberUpdate = updates.find((u) => u.target === 'member');
    expect(memberUpdate?.data).toMatchObject({ manager: true, portalAccess: 'active' });
    // family.managers arrayUnion
    const familyUpdate = updates.find((u) => u.target === 'family');
    expect(familyUpdate?.data.managers).toEqual({ _arrayUnion: ['F1-02'] });
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith('F1-02');
    // request marked approved
    const reqUpdate = updates.find((u) => u.target === 'request');
    expect(reqUpdate?.data.status).toBe('approved');
    // contactKey ensured
    const ckSet = sets.find((s) => s.target === 'contactKey');
    expect(ckSet?.data).toMatchObject({ fid: 'F1', mid: 'F1-02', type: 'email' });
  });

  it('returns fid-mismatch when the request belongs to another family', async () => {
    const { updates } = setupDb({
      reqFid: 'F2',
      request: { matchedMid: 'F2-02', status: 'pending', requesterEmail: 'x@example.com' },
    });
    const res = await approveJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ error: 'fid-mismatch' });
    expect(updates).toHaveLength(0);
  });

  it('returns not-found when no request matches the token', async () => {
    setupDb({ reqFid: null });
    const res = await approveJoinRequest({ token: 'missing', managerFid: 'F1' });
    expect(res).toEqual({ error: 'not-found' });
  });

  it('returns already-resolved when the request is not pending', async () => {
    const { updates } = setupDb({
      reqFid: 'F1',
      request: { matchedMid: 'F1-02', status: 'approved', requesterEmail: 'asha@example.com' },
    });
    const res = await approveJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ error: 'already-resolved' });
    expect(updates).toHaveLength(0);
  });

  it('returns contact-conflict when the contactKey points to a different family (theft check)', async () => {
    const { updates } = setupDb({
      reqFid: 'F1',
      request: { matchedMid: 'F1-02', status: 'pending', requesterEmail: 'asha@example.com', expiresAt: new Date(Date.now() + 86400_000) },
      member: { email: 'asha@example.com' },
      existingContactKey: { fid: 'OTHER' },
    });
    const res = await approveJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ error: 'contact-conflict' });
    expect(updates).toHaveLength(0);
  });

  it('returns expired when the request is past its TTL', async () => {
    const { updates } = setupDb({
      reqFid: 'F1',
      request: { matchedMid: 'F1-02', status: 'pending', requesterEmail: 'asha@example.com', expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await approveJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ error: 'expired' });
    expect(updates).toHaveLength(0);
  });
});
