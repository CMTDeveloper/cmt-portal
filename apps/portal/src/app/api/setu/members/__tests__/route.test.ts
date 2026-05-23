import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));

import { POST } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const mockRunTransaction = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();

function makeChainRef(): Record<string, unknown> {
  const ref: Record<string, unknown> = {};
  ref['doc'] = vi.fn(() => makeChainRef());
  ref['collection'] = vi.fn(() => makeChainRef());
  ref['set'] = mockSet;
  ref['delete'] = vi.fn();
  return ref;
}

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function managerHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-01'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

function memberHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-02'): Record<string, string> {
  return { 'x-portal-role': 'family-member', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

const validBody = {
  firstName: 'Diya',
  lastName: 'Patel',
  type: 'Child',
  gender: 'Female',
  schoolGrade: 'Grade 5',
};

beforeEach(() => {
  vi.clearAllMocks();

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => {
    const txn = { get: mockGet, set: mockSet };
    return fn(txn);
  });

  const familySnap = {
    exists: true,
    data: () => ({ fid: 'FAM001ABCD12', managers: ['FAM001ABCD12-01'] }),
  };
  const membersSnap = { size: 1, docs: [] };

  mockGet
    .mockResolvedValueOnce(familySnap)
    .mockResolvedValueOnce(membersSnap);

  const chainRef = makeChainRef();
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collection: vi.fn(() => chainRef),
  });
});

describe('POST /api/setu/members', () => {
  it('returns 403 for family-member (not manager)', async () => {
    const res = await POST(makeRequest(validBody, memberHeaders()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('manager-required');
  });

  it('returns 401 when no role', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 400 on missing firstName', async () => {
    const { firstName: _firstName, ...rest } = validBody;
    void _firstName;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing type', async () => {
    const { type: _type, ...rest } = validBody;
    void _type;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid type value', async () => {
    const res = await POST(makeRequest({ ...validBody, type: 'Pet' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid gender value', async () => {
    const res = await POST(makeRequest({ ...validBody, gender: 'Unknown' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 201 with new mid on success', async () => {
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mid).toBeDefined();
    expect(body.mid).toMatch(/^FAM001ABCD12-/);
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(404);
  });

  it('returns 400 when fid missing from session', async () => {
    const res = await POST(makeRequest(validBody, {
      'x-portal-role': 'family-manager',
      'x-portal-mid': 'FAM001ABCD12-01',
      'x-portal-uid': 'uid-raj',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing-fid');
  });
});
