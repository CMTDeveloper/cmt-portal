import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: vi.fn((...args: string[]) => ({ _arrayUnion: args })),
  },
}));
vi.mock('@/features/setu/auth/get-current-session-email', () => ({
  getSessionContactFromHeaders: vi.fn(),
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn(),
  exchangeCustomTokenForIdToken: vi.fn(),
}));
// Public-id allocator mock (issue #4). Accepting an invite CREATES a new co-manager
// member doc, so it allocates exactly one publicMid; mock it deterministically.
vi.mock('@/features/setu/ids/public-id-allocator', () => ({
  allocateMemberPublicIds: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, i) => String(50001 + i)),
  ),
}));

import { POST } from '../route';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { getSessionContactFromHeaders } from '@/features/setu/auth/get-current-session-email';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { revalidateTag } from 'next/cache';

const mockSetCustomUserClaims = vi.fn();
const mockCreateCustomToken = vi.fn();

const mockGetSession = vi.mocked(getSessionContactFromHeaders);
const mockRunTransaction = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/invite/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeChainRef(): Record<string, unknown> {
  const ref: Record<string, unknown> = {};
  ref['doc'] = vi.fn(() => makeChainRef());
  ref['collection'] = vi.fn(() => makeChainRef());
  ref['set'] = mockSet;
  ref['update'] = mockUpdate;
  ref['delete'] = vi.fn();
  return ref;
}

const validInvite = {
  token: 'tok-abc123',
  fid: 'FAM001ABCD12',
  inviterMid: 'FAM001ABCD12-01',
  inviterName: 'Raj Patel',
  familyName: 'Patel Family',
  relation: 'Spouse',
  email: 'priya@example.com',
  expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  acceptedAt: null,
  acceptedByMid: null,
};

const validSession = {
  type: 'email' as const,
  value: 'priya@example.com',
  uid: 'uid-priya',
};

beforeEach(() => {
  vi.clearAllMocks();

  (portalAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    setCustomUserClaims: mockSetCustomUserClaims,
    createCustomToken: mockCreateCustomToken,
  });
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  mockCreateCustomToken.mockResolvedValue('custom-token');
  (exchangeCustomTokenForIdToken as ReturnType<typeof vi.fn>).mockResolvedValue('id-token');
  (createPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValue('session-cookie');

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => {
    const txn = { get: mockGet, set: mockSet, update: mockUpdate };
    return fn(txn);
  });

  const familySnap = {
    exists: true,
    data: () => ({ fid: 'FAM001ABCD12', name: 'Patel Family', managers: ['FAM001ABCD12-01'] }),
  };
  const membersSnap = { size: 1, docs: [] };
  const contactKeySnap = { exists: false };
  const inviteSnap = {
    exists: true,
    data: () => ({
      token: validInvite.token,
      inviterMid: validInvite.inviterMid,
      inviterName: validInvite.inviterName,
      familyName: validInvite.familyName,
      relation: validInvite.relation,
      email: validInvite.email,
      expiresAt: { toDate: () => validInvite.expiresAt },
      acceptedAt: null,
      acceptedByMid: null,
    }),
    ref: {
      parent: { parent: { id: 'FAM001ABCD12' } },
      update: mockUpdate,
    },
  };

  mockGet
    .mockResolvedValueOnce(inviteSnap)   // invite doc inside txn
    .mockResolvedValueOnce(familySnap)   // family doc
    .mockResolvedValueOnce(membersSnap)  // members collection
    .mockResolvedValueOnce(contactKeySnap); // contactKey

  const chainRef = makeChainRef();
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collection: vi.fn(() => chainRef),
    collectionGroup: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            empty: false,
            docs: [inviteSnap],
          }),
        })),
      })),
    })),
  });
});

describe('POST /api/setu/invite/accept', () => {
  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session', async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 400 when token missing from body', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('bad-request');
  });

  it('returns 404 when token not found', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockRejectedValueOnce(new Error('invite-not-found'));
    const res = await POST(makeRequest({ token: 'missing-tok' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('invite-not-found');
  });

  it('returns 410 when invite is expired', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockRejectedValueOnce(new Error('invite-expired'));
    const res = await POST(makeRequest({ token: 'tok-expired' }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('expired');
  });

  it('returns 409 when invite already accepted', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockRejectedValueOnce(new Error('invite-already-accepted'));
    const res = await POST(makeRequest({ token: 'tok-used' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already-accepted');
  });

  it('returns 403 when verified-contact email does not match invite email', async () => {
    mockGetSession.mockReturnValueOnce({
      type: 'email' as const,
      value: 'other@example.com',
      uid: 'uid-other',
    });
    mockRunTransaction.mockRejectedValueOnce(new Error('email-mismatch'));
    const res = await POST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('email-mismatch');
  });

  it('returns 409 when contactKey already belongs to a different family', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockRejectedValueOnce(new Error('contact-conflict'));
    const res = await POST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('contact-already-registered');
  });

  it('happy path: creates member, updates family.managers, writes contactKey, marks acceptedAt', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockImplementationOnce(async (fn: (txn: unknown) => unknown) => {
      const txn = { get: mockGet, set: mockSet, update: mockUpdate };
      return fn(txn);
    });
    const res = await POST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mid).toBeDefined();
    expect(body.fid).toBe('FAM001ABCD12');
    expect(body.mid).toMatch(/^FAM001ABCD12-/);
    expect(body.redirectTo).toBe('/family');
    // Verify FieldValue.arrayUnion was called (for managers update)
    expect(FieldValue.arrayUnion).toHaveBeenCalled();
    // Verify set was called (for member + contactKey + invite update)
    expect(mockSet).toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('assigns a publicMid to the new co-manager member doc (issue #4)', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockImplementationOnce(async (fn: (txn: unknown) => unknown) => {
      const txn = { get: mockGet, set: mockSet, update: mockUpdate };
      return fn(txn);
    });
    const res = await POST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(200);
    // The new member doc is the only set() payload carrying a firstName field.
    const memberWrite = mockSet.mock.calls.find(
      ([, data]) => data && typeof data === 'object' && 'firstName' in data,
    );
    expect(memberWrite?.[1]).toMatchObject({ publicMid: '50001' });
  });

  it('happy path: sets __session cookie with refreshed claims after invite accept', async () => {
    mockGetSession.mockReturnValueOnce(validSession);
    mockRunTransaction.mockImplementationOnce(async (fn: (txn: unknown) => unknown) => {
      const txn = { get: mockGet, set: mockSet, update: mockUpdate };
      return fn(txn);
    });
    const res = await POST(makeRequest({ token: 'tok-abc123' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      validSession.uid,
      expect.objectContaining({ role: 'family-manager', fid: 'FAM001ABCD12', email: validSession.value }),
    );
    expect(exchangeCustomTokenForIdToken).toHaveBeenCalledWith('custom-token');
    expect(createPortalSessionCookie).toHaveBeenCalledWith('id-token', expect.any(Number));
  });
});
