import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

const mockSearchFamilies = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/search/search-families', () => ({
  searchFamilies: mockSearchFamilies,
}));

import { GET } from '../route';

function makeRequest(q?: string, role?: string): Request {
  const url = q !== undefined
    ? `http://localhost/api/setu/family/search?q=${encodeURIComponent(q)}`
    : 'http://localhost/api/setu/family/search';
  const headers: Record<string, string> = {};
  if (role !== undefined) {
    headers['x-portal-role'] = role;
  }
  return new Request(url, { method: 'GET', headers });
}

const sampleHit = {
  fid: 'FAM001ABCD12',
  name: 'Patel',
  location: 'Brampton',
  managerEmail: 'raj@example.com',
  managerPhone: '4165551234',
  memberCount: 3,
  legacyFid: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchFamilies.mockResolvedValue([]);
});

describe('GET /api/setu/family/search', () => {
  it('returns 404 when setuAuth flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    vi.doMock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
    vi.doMock('@/features/setu/search/search-families', () => ({ searchFamilies: mockSearchFamilies }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest('patel', 'welcome-team'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when x-portal-role header is missing', async () => {
    const res = await GET(makeRequest('patel', undefined));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 403 when role is family-manager', async () => {
    const res = await GET(makeRequest('patel', 'family-manager'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
  });

  it('returns 403 when role is family-member', async () => {
    const res = await GET(makeRequest('patel', 'family-member'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
  });

  it('returns 403 when role is admin', async () => {
    const res = await GET(makeRequest('patel', 'admin'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
  });

  it('returns 200 with empty hits when q param is missing', async () => {
    const res = await GET(makeRequest(undefined, 'welcome-team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hits: [] });
    expect(mockSearchFamilies).not.toHaveBeenCalled();
  });

  it('returns 200 with empty hits when q is whitespace only', async () => {
    const res = await GET(makeRequest('   ', 'welcome-team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hits: [] });
    expect(mockSearchFamilies).not.toHaveBeenCalled();
  });

  it('returns 200 with hits when q matches by name', async () => {
    mockSearchFamilies.mockResolvedValue([sampleHit]);
    const res = await GET(makeRequest('patel', 'welcome-team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].fid).toBe('FAM001ABCD12');
    expect(mockSearchFamilies).toHaveBeenCalledWith('patel');
  });

  it('returns 200 with hits when q matches by email', async () => {
    mockSearchFamilies.mockResolvedValue([sampleHit]);
    const res = await GET(makeRequest('raj@example.com', 'welcome-team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits).toHaveLength(1);
    expect(mockSearchFamilies).toHaveBeenCalledWith('raj@example.com');
  });

  it('returns 200 with hits when q matches by legacy fid', async () => {
    mockSearchFamilies.mockResolvedValue([{ ...sampleHit, legacyFid: 'LEG-42' }]);
    const res = await GET(makeRequest('LEG-42', 'welcome-team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].legacyFid).toBe('LEG-42');
    expect(mockSearchFamilies).toHaveBeenCalledWith('LEG-42');
  });
});
