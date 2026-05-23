import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockCookiesGet = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockCookiesGet }),
  headers: vi.fn(() => new Headers()),
}));

const mockVerifySession = vi.hoisted(() => vi.fn());
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: mockVerifySession,
}));

const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mockGetFamilyByFid,
}));

import { GET } from '../route';

const familyDoc = {
  fid: 'FAM001ABCD12',
  legacyFid: null,
  name: 'Patel',
  location: 'Brampton',
  createdAt: new Date('2026-01-01'),
  managers: ['FAM001ABCD12-01'],
  searchKeys: ['patel', 'FAM001ABCD12'],
};

const memberDoc = {
  mid: 'FAM001ABCD12-01',
  uid: 'uid-raj',
  firstName: 'Raj',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Male',
  manager: true,
  joinedAt: new Date('2026-01-01'),
  email: 'raj@example.com',
  phone: '4165551234',
  schoolGrade: null,
  birthMonthYear: null,
  volunteeringSkills: [],
  foodAllergies: null,
  emergencyContacts: [null, null],
};

function makeRequest() {
  return new Request('http://localhost/api/setu/family', { method: 'GET' });
}

function setupSession(role: string, fid: string, mid: string) {
  mockCookiesGet.mockReturnValue({ value: 'fake-cookie' });
  mockVerifySession.mockResolvedValue({ uid: `uid-${mid}`, role, fid, mid });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCookiesGet.mockReturnValue(null);
  mockVerifySession.mockResolvedValue(null);
  mockGetFamilyByFid.mockResolvedValue({ family: familyDoc, members: [memberDoc] });
});

describe('GET /api/setu/family', () => {
  it('returns 401 when no session', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 401 when wrong role', async () => {
    mockCookiesGet.mockReturnValue({ value: 'fake-cookie' });
    mockVerifySession.mockResolvedValue({ uid: 'uid-x', role: 'teacher', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' });
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 200 with family + members when session valid (manager)', async () => {
    setupSession('family-manager', 'FAM001ABCD12', 'FAM001ABCD12-01');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.family.fid).toBe('FAM001ABCD12');
    expect(body.members).toHaveLength(1);
    expect(body.members[0].mid).toBe('FAM001ABCD12-01');
    expect(body.currentMid).toBe('FAM001ABCD12-01');
    expect(body.isManager).toBe(true);
  });

  it('returns 200 with isManager false for family-member', async () => {
    setupSession('family-member', 'FAM001ABCD12', 'FAM001ABCD12-02');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isManager).toBe(false);
    expect(body.currentMid).toBe('FAM001ABCD12-02');
  });

  it('returns 404 when family document does not exist', async () => {
    setupSession('family-manager', 'FAM001ABCD12', 'FAM001ABCD12-01');
    mockGetFamilyByFid.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { GET: flaggedGET } = await import('../route');
    const res = await flaggedGET(makeRequest());
    expect(res.status).toBe(404);
  });

  it('does not set session cookie on GET', async () => {
    setupSession('family-manager', 'FAM001ABCD12', 'FAM001ABCD12-01');
    const res = await GET(makeRequest());
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
