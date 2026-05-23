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
  email: 'invitee@example.com',
  relation: 'Spouse',
};

function setupFirestoreMock(overrides: {
  familyExists?: boolean;
  familyName?: string;
  memberExists?: boolean;
  inviterName?: string;
} = {}) {
  const {
    familyExists = true,
    familyName = 'Sharma Family',
    memberExists = true,
    inviterName = 'Raj Sharma',
  } = overrides;

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => {
    const txn = { get: mockGet, set: mockSet };
    return fn(txn);
  });

  const familySnap = {
    exists: familyExists,
    data: () => familyExists ? { fid: 'FAM001ABCD12', name: familyName } : undefined,
  };
  const memberSnap = {
    exists: memberExists,
    data: () => memberExists ? { mid: 'FAM001ABCD12-01', firstName: 'Raj', lastName: 'Sharma', displayName: inviterName } : undefined,
  };

  mockGet
    .mockResolvedValueOnce(familySnap)
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
    const res = await POST(makeRequest({ email: 'Invitee@EXAMPLE.COM', relation: 'Sibling' }, managerHeaders()));
    expect(res.status).toBe(201);
    const call = mockSendEmail.mock.calls[0]![0] as { to: string };
    expect(call.to).toBe('invitee@example.com');
  });

  it('happy path: writes invite doc with correct fields', async () => {
    await POST(makeRequest(validBody, managerHeaders()));
    expect(mockSet).toHaveBeenCalledOnce();
    const docData = mockSet.mock.calls[0]![1] as Record<string, unknown>;
    expect(docData.email).toBe('invitee@example.com');
    expect(docData.relation).toBe('Spouse');
    expect(docData.inviterMid).toBe('FAM001ABCD12-01');
    expect(docData.acceptedAt).toBeNull();
    expect(docData.token).toBeDefined();
  });

  it('happy path: inviterName resolves from members subcollection', async () => {
    await POST(makeRequest(validBody, managerHeaders()));
    const docData = mockSet.mock.calls[0]![1] as Record<string, unknown>;
    expect(docData.inviterName).toBe('Raj Sharma');
  });

  it('happy path: expiresAt is 14 days from now', async () => {
    const now = new Date('2026-05-23T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await POST(makeRequest(validBody, managerHeaders()));

    const docData = mockSet.mock.calls[0]![1] as Record<string, unknown>;
    const expected = new Date(now.getTime() + 14 * 86400_000);
    expect(Timestamp.fromDate).toHaveBeenCalledWith(expected);
    expect(docData.expiresAt).toEqual({ _date: expected });

    vi.useRealTimers();
  });
});
