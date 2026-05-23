import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/invite/get-invite', () => ({
  getInviteByToken: vi.fn(),
}));

import { GET } from '../route';
import { getInviteByToken } from '@/features/setu/invite/get-invite';

const mockGetInvite = vi.mocked(getInviteByToken);

function makeRequest(token: string) {
  return new Request(`http://localhost/api/setu/invite/${encodeURIComponent(token)}`);
}

const happyInvite = {
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/invite/[token]', () => {
  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    vi.doMock('@/features/setu/invite/get-invite', () => ({
      getInviteByToken: vi.fn(),
    }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest('tok-abc123'), {
      params: Promise.resolve({ token: 'tok-abc123' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when token not found', async () => {
    mockGetInvite.mockResolvedValueOnce({ error: 'not-found' });
    const res = await GET(makeRequest('missing-tok'), {
      params: Promise.resolve({ token: 'missing-tok' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not-found');
  });

  it('returns 410 when invite is expired', async () => {
    mockGetInvite.mockResolvedValueOnce({ error: 'expired' });
    const res = await GET(makeRequest('tok-expired'), {
      params: Promise.resolve({ token: 'tok-expired' }),
    });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('expired');
  });

  it('returns 409 when invite already accepted', async () => {
    mockGetInvite.mockResolvedValueOnce({ error: 'accepted' });
    const res = await GET(makeRequest('tok-used'), {
      params: Promise.resolve({ token: 'tok-used' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already-accepted');
  });

  it('returns 200 with safe metadata on happy path', async () => {
    mockGetInvite.mockResolvedValueOnce(happyInvite);
    const res = await GET(makeRequest('tok-abc123'), {
      params: Promise.resolve({ token: 'tok-abc123' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.familyName).toBe('Patel Family');
    expect(body.inviterName).toBe('Raj Patel');
    expect(body.relation).toBe('Spouse');
    expect(body.expiresAt).toBeDefined();
    // Must NOT return inviter email or contact info
    expect(body.email).toBeUndefined();
    expect(body.inviterMid).toBeUndefined();
    expect(body.fid).toBeUndefined();
  });
});
