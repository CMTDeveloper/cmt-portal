import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: { fromDate: vi.fn((d: Date) => ({ _date: d })) },
}));
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: () => ({ sendEmail: mockSendEmail, sendSMS: vi.fn() }),
}));
vi.mock('@/lib/env', () => ({
  portalEnv: vi.fn(() => ({
    SETU_INVITE_TTL_DAYS: 14,
    NEXT_PUBLIC_PORTAL_BASE_URL: 'https://portal.example.org',
  })),
}));
// The pending co-manager member gets a 5-digit publicMid allocated BEFORE the txn.
vi.mock('@/features/setu/ids/public-id-allocator', () => ({
  allocateMemberPublicIds: vi.fn(async () => ['50999']),
}));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);

import { POST } from '../route';
import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { revalidateTag } from 'next/cache';

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
  return new Request('http://localhost/api/setu/invite/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function managerHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-01'): Record<string, string> {
  return {
    'x-portal-role': 'family-manager',
    'x-portal-fid': fid,
    'x-portal-mid': mid,
    'x-portal-uid': `uid-${mid}`,
  };
}

const validBody = {
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'invitee@example.com',
  relation: 'Spouse',
};

/** Among all txn.set() calls, the invite doc is the one carrying a `token`. */
function inviteDocData(): Record<string, unknown> {
  const call = mockSet.mock.calls.find((c) => (c[1] as Record<string, unknown>)?.token !== undefined);
  if (!call) throw new Error('no invite doc was written');
  return call[1] as Record<string, unknown>;
}
/** The pending member doc is the txn.set() carrying inviteStatus:'pending'. */
function pendingMemberData(): Record<string, unknown> | undefined {
  const call = mockSet.mock.calls.find((c) => (c[1] as Record<string, unknown>)?.inviteStatus === 'pending');
  return call?.[1] as Record<string, unknown> | undefined;
}

// `mid` is optional — set it to model an explicit doc id (e.g. a numbering gap);
// otherwise the mock synthesizes a sequential id.
type RosterMember = { email?: string | null; altEmails?: string[]; mid?: string };

function setupFirestoreMock(overrides: {
  familyExists?: boolean;
  familyName?: string;
  memberExists?: boolean;
  inviterName?: string;
  roster?: RosterMember[];
} = {}) {
  const {
    familyExists = true,
    familyName = 'Sharma Family',
    memberExists = true,
    inviterName = 'Raj Sharma',
    roster = [],
  } = overrides;

  // Reset queued get() resolutions so tests that re-invoke setup (e.g. to supply
  // a roster) don't consume the default empty-roster reads queued in beforeEach.
  mockGet.mockReset();

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => {
    const txn = { get: mockGet, set: mockSet };
    return fn(txn);
  });

  const familySnap = {
    exists: familyExists,
    data: () => familyExists ? { fid: 'FAM001ABCD12', name: familyName } : undefined,
  };
  // The route reads the members subcollection to reject inviting an existing
  // member AND to allocate the next mid; the read returns a query snapshot whose
  // docs carry a real `.id` (sequential member ids, manager = -01, like Firestore).
  const membersSnap = {
    docs: roster.map((m, i) => ({
      // Honor an explicit `mid` (to model numbering gaps) else synthesize a
      // sequential id (manager = -01), like Firestore returns.
      id: m.mid ?? `FAM001ABCD12-${String(i + 1).padStart(2, '0')}`,
      data: () => m,
    })),
  };
  const memberSnap = {
    exists: memberExists,
    data: () => memberExists ? { mid: 'FAM001ABCD12-01', firstName: 'Raj', lastName: 'Sharma', displayName: inviterName } : undefined,
  };

  mockGet
    .mockResolvedValueOnce(familySnap)
    .mockResolvedValueOnce(membersSnap)
    .mockResolvedValueOnce(memberSnap);

  const chainRef = makeChainRef();
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collection: vi.fn(() => chainRef),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
  setupFirestoreMock();
});

describe('POST /api/setu/invite/send', () => {
  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(404);
  });

  it('returns 401 when no role header', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 403 when role is family-member not family-manager', async () => {
    const res = await POST(makeRequest(validBody, {
      'x-portal-role': 'family-member',
      'x-portal-fid': 'FAM001ABCD12',
      'x-portal-mid': 'FAM001ABCD12-02',
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('manager-required');
  });

  it('returns 400 when fid is missing', async () => {
    const res = await POST(makeRequest(validBody, {
      'x-portal-role': 'family-manager',
      'x-portal-mid': 'FAM001ABCD12-01',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing-fid');
  });

  it('returns 400 when body has invalid email', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email', relation: 'Spouse' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 when relation is missing', async () => {
    const res = await POST(makeRequest({ email: 'test@example.com' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 when relation is empty string', async () => {
    const res = await POST(makeRequest({ email: 'test@example.com', relation: '' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await POST(makeRequest({ relation: 'Sibling' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('happy path: returns 201 with token', async () => {
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('happy path: token is base64url (no +/= chars, 32+ chars)', async () => {
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.token.length).toBeGreaterThanOrEqual(32);
  });

  it('happy path: does not return email or URL in response', async () => {
    const res = await POST(makeRequest(validBody, managerHeaders()));
    const body = await res.json();
    expect(body.email).toBeUndefined();
    expect(body.acceptUrl).toBeUndefined();
    expect(body.url).toBeUndefined();
  });

  it('happy path: calls sendEmail with subject containing inviter name', async () => {
    await POST(makeRequest(validBody, managerHeaders()));
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const call = mockSendEmail.mock.calls[0]![0] as { subject: string; to: string };
    expect(call.subject).toContain('Raj Sharma');
  });

  it('happy path: calls sendEmail with accept URL in text/html', async () => {
    await POST(makeRequest(validBody, managerHeaders()));
    const call = mockSendEmail.mock.calls[0]![0] as { text: string; html?: string };
    expect(call.text).toContain('/invite/');
  });

  it('happy path: calls sendEmail to the invitee email (normalized lowercase)', async () => {
    const res = await POST(makeRequest({ firstName: 'Priya', lastName: 'Sharma', email: 'Invitee@EXAMPLE.COM', relation: 'Sibling' }, managerHeaders()));
    expect(res.status).toBe(201);
    const call = mockSendEmail.mock.calls[0]![0] as { to: string };
    expect(call.to).toBe('invitee@example.com');
  });

  it('happy path: writes invite doc with correct fields', async () => {
    await POST(makeRequest(validBody, managerHeaders()));
    const docData = inviteDocData();
    expect(docData.email).toBe('invitee@example.com');
    expect(docData.relation).toBe('Spouse');
    expect(docData.inviterMid).toBe('FAM001ABCD12-01');
    expect(docData.acceptedAt).toBeNull();
    expect(docData.token).toBeDefined();
    // The invite now links the pending member doc it created.
    expect(docData.memberMid).toBeDefined();
    expect(typeof docData.memberMid).toBe('string');
  });

  it('requires firstName and lastName (400 without a name)', async () => {
    const noName = await POST(makeRequest({ email: 'x@y.com', relation: 'Spouse' }, managerHeaders()));
    expect(noName.status).toBe(400);
    const noLast = await POST(makeRequest({ firstName: 'Priya', email: 'x@y.com', relation: 'Spouse' }, managerHeaders()));
    expect(noLast.status).toBe(400);
    const emptyName = await POST(makeRequest({ firstName: ' ', lastName: 'Sharma', email: 'x@y.com', relation: 'Spouse' }, managerHeaders()));
    expect(emptyName.status).toBe(400);
  });

  it('creates a pending co-manager member (visible before accept) with the invited name + email', async () => {
    // Roster has the existing manager, so the new pending member is -02.
    setupFirestoreMock({ roster: [{ email: 'raj@sharma.com', altEmails: [] }] });
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const member = pendingMemberData();
    expect(member, 'a pending member doc must be written at send').toBeDefined();
    expect(member!.inviteStatus).toBe('pending');
    expect(member!.manager).toBe(true);
    expect(member!.uid).toBeNull();
    expect(member!.type).toBe('Adult');
    expect(member!.firstName).toBe('Priya');
    expect(member!.lastName).toBe('Sharma');
    expect(member!.email).toBe('invitee@example.com');
    expect(member!.mid).toBe('FAM001ABCD12-02');
    expect(member!.publicMid).toBe('50999');
    // The invite doc records this member's mid.
    expect(inviteDocData().memberMid).toBe('FAM001ABCD12-02');
  });

  it('never reuses a deleted member’s slot — regression for the Rana-family data loss', async () => {
    // The wife (-02) had been deleted, leaving a gap: -01, -03, -04. The old
    // count+1 logic computed -04 and OVERWROTE the child at -04. The new mid MUST
    // be -05 so no existing member doc is clobbered.
    setupFirestoreMock({
      roster: [
        { mid: 'FAM001ABCD12-01', email: 'vaibhav@rana.com', altEmails: [] },
        { mid: 'FAM001ABCD12-03', email: 'parth@rana.com', altEmails: [] },
        { mid: 'FAM001ABCD12-04', email: 'harshita@rana.com', altEmails: [] },
      ],
    });
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const member = pendingMemberData();
    expect(member!.mid).toBe('FAM001ABCD12-05');
    expect(inviteDocData().memberMid).toBe('FAM001ABCD12-05');
  });

  it('does NOT add the pending member to family.managers (that waits for accept)', async () => {
    setupFirestoreMock({ roster: [{ email: 'raj@sharma.com', altEmails: [] }] });
    await POST(makeRequest(validBody, managerHeaders()));
    // The only txn.update in this route (if any) must never touch managers. We
    // assert no set/update wrote a `managers` arrayUnion — the pending member is
    // not a real manager until they accept.
    const touchedManagers = mockSet.mock.calls.some((c) => 'managers' in ((c[1] as Record<string, unknown>) ?? {}));
    expect(touchedManagers).toBe(false);
  });

  it('happy path: inviterName resolves from members subcollection', async () => {
    await POST(makeRequest(validBody, managerHeaders()));
    expect(inviteDocData().inviterName).toBe('Raj Sharma');
  });

  it('happy path: expiresAt is 14 days from now', async () => {
    const now = new Date('2026-05-23T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await POST(makeRequest(validBody, managerHeaders()));

    const docData = inviteDocData();
    const expected = new Date(now.getTime() + 14 * 86400_000);
    expect(Timestamp.fromDate).toHaveBeenCalledWith(expected);
    expect(docData.expiresAt).toEqual({ _date: expected });

    vi.useRealTimers();
  });

  it('returns 409 already-member when email matches an existing member email', async () => {
    setupFirestoreMock({ roster: [{ email: 'invitee@example.com', altEmails: [] }] });
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already-member');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 409 already-member matching case-insensitively', async () => {
    setupFirestoreMock({ roster: [{ email: 'INVITEE@Example.com', altEmails: [] }] });
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already-member');
  });

  it('returns 409 already-member when email matches a member altEmail', async () => {
    setupFirestoreMock({ roster: [{ email: 'someone@else.com', altEmails: ['invitee@example.com'] }] });
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already-member');
  });

  it('returns 201 for a genuinely new email even when other members exist', async () => {
    setupFirestoreMock({ roster: [{ email: 'someone@else.com', altEmails: ['other@else.com'] }] });
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });
});
