import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import { declineJoinRequest } from '../decline-request';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

function setupDb(opts: { reqFid?: string | null; status?: string }) {
  const { reqFid = 'F1', status = 'pending' } = opts;
  const updates: Array<Record<string, unknown>> = [];
  const reqRef = { parent: { parent: reqFid ? { id: reqFid } : null }, _kind: 'request' };
  const txn = {
    get: vi.fn(async () => ({ exists: true, data: () => ({ status }) })),
    update: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
      updates.push(data);
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
    runTransaction: vi.fn(async (fn: (t: typeof txn) => unknown) => fn(txn)),
  };
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(db);
  return { updates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('declineJoinRequest', () => {
  it('marks the request declined', async () => {
    const { updates } = setupDb({ reqFid: 'F1', status: 'pending' });
    const res = await declineJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ ok: true });
    expect(updates[0]?.status).toBe('declined');
  });

  it('returns fid-mismatch for another family', async () => {
    const { updates } = setupDb({ reqFid: 'F2', status: 'pending' });
    const res = await declineJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ error: 'fid-mismatch' });
    expect(updates).toHaveLength(0);
  });

  it('returns not-found when no request matches', async () => {
    setupDb({ reqFid: null });
    const res = await declineJoinRequest({ token: 'missing', managerFid: 'F1' });
    expect(res).toEqual({ error: 'not-found' });
  });

  it('returns already-resolved when not pending', async () => {
    const { updates } = setupDb({ reqFid: 'F1', status: 'declined' });
    const res = await declineJoinRequest({ token: 'tok', managerFid: 'F1' });
    expect(res).toEqual({ error: 'already-resolved' });
    expect(updates).toHaveLength(0);
  });
});
