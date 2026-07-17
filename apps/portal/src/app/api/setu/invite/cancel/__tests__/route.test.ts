import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

import { POST } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { revalidateTag } from 'next/cache';

const mockRunTransaction = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();

function makeChainRef(): Record<string, unknown> {
  const ref: Record<string, unknown> = {};
  ref['doc'] = vi.fn(() => makeChainRef());
  ref['collection'] = vi.fn(() => makeChainRef());
  ref['where'] = vi.fn(() => makeChainRef());
  ref['limit'] = vi.fn(() => makeChainRef());
  ref['delete'] = mockDelete;
  return ref;
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/invite/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function managerHeaders(fid = 'FAM001ABCD12'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid };
}

const MID = 'FAM001ABCD12-03';

function setupFirestore(opts: { inviteFound?: boolean; acceptedAt?: unknown; memberExists?: boolean; memberInviteStatus?: string } = {}) {
  const { inviteFound = true, acceptedAt = null, memberExists = true, memberInviteStatus = 'pending' } = opts;
  mockGet.mockReset();
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => fn({ get: mockGet, delete: mockDelete }));

  // The invite is found via a `where('memberMid','==',mid)` query → a snapshot
  // whose .docs[0] is the invite doc (with its own .ref for deletion).
  const inviteDoc = { data: () => ({ token: 'tok', acceptedAt, memberMid: MID }), ref: { delete: mockDelete } };
  const inviteQuerySnap = { docs: inviteFound ? [inviteDoc] : [] };
  const memberSnap = { exists: memberExists, data: () => (memberExists ? { mid: MID, inviteStatus: memberInviteStatus } : undefined) };
  mockGet.mockResolvedValueOnce(inviteQuerySnap).mockResolvedValueOnce(memberSnap);

  const chainRef = makeChainRef();
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collection: vi.fn(() => chainRef),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupFirestore();
});

describe('POST /api/setu/invite/cancel', () => {
  it('404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    expect((await flaggedPOST(makeRequest({ mid: MID }, managerHeaders()))).status).toBe(404);
  });

  it('401 when no role header', async () => {
    expect((await POST(makeRequest({ mid: MID }))).status).toBe(401);
  });

  it('403 when role is family-member (manager-only)', async () => {
    const res = await POST(makeRequest({ mid: MID }, { 'x-portal-role': 'family-member', 'x-portal-fid': 'FAM001ABCD12' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('manager-required');
  });

  it('400 when mid is missing', async () => {
    expect((await POST(makeRequest({}, managerHeaders()))).status).toBe(400);
  });

  it('404 when no pending invite matches the mid', async () => {
    setupFirestore({ inviteFound: false });
    const res = await POST(makeRequest({ mid: 'nope' }, managerHeaders()));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('invite-not-found');
  });

  it('409 when the invite was already accepted (cancel is not member-removal)', async () => {
    setupFirestore({ acceptedAt: new Date() });
    const res = await POST(makeRequest({ mid: MID }, managerHeaders()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already-accepted');
  });

  it('happy path: deletes the pending member AND the invite, revalidates', async () => {
    const res = await POST(makeRequest({ mid: MID }, managerHeaders()));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Two deletes: the pending member doc + the invite doc.
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('deletes only the invite when the member is not pending (defensive — never removes an active member)', async () => {
    setupFirestore({ memberInviteStatus: 'active' as unknown as string });
    await POST(makeRequest({ mid: MID }, managerHeaders()));
    // Member is not pending → only the invite doc is deleted.
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('deletes only the invite when the pending member is already gone', async () => {
    setupFirestore({ memberExists: false });
    await POST(makeRequest({ mid: MID }, managerHeaders()));
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
