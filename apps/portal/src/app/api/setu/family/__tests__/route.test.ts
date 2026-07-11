import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: mockGetFamilyByFid,
}));

// PATCH writes the family-level emergency contact via portalFirestore().
// Capture the set() call so we can assert the merge write shape.
const mockSet = vi.hoisted(() => vi.fn());
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({ doc: () => ({ set: mockSet }) }),
  }),
}));

import { GET, PATCH } from '../route';
import { revalidateTag } from 'next/cache';

const familyDoc = {
  fid: 'FAM001ABCD12',
  publicFid: '1042',
  legacyFid: null,
  name: 'Patel',
  location: 'Brampton',
  createdAt: new Date('2026-01-01'),
  managers: ['FAM001ABCD12-01'],
  searchKeys: ['patel', 'FAM001ABCD12'],
};

const memberDoc = {
  mid: 'FAM001ABCD12-01',
  publicMid: '50001',
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

// The route authenticates from the middleware-set x-portal-* headers — this
// is exactly what a Bearer (mobile) request looks like after middleware.
function makeRequest(session?: { role: string; fid: string; mid: string }) {
  const headers = new Headers();
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-uid', `uid-${session.mid}`);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/family', { method: 'GET', headers });
}

function makePatchRequest(
  session: { role: string; fid: string; mid: string } | undefined,
  body: unknown,
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-uid', `uid-${session.mid}`);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/family', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFamilyByFid.mockResolvedValue({ family: familyDoc, members: [memberDoc] });
});

describe('GET /api/setu/family', () => {
  it('returns 401 when no session headers', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 401 when wrong role', async () => {
    const res = await GET(makeRequest({ role: 'teacher', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 with family + members when session valid (manager)', async () => {
    const res = await GET(makeRequest({ role: 'family-manager', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.family.fid).toBe('FAM001ABCD12');
    // Public 4-digit FID is exposed at family level alongside the join-key `fid` (issue #4).
    expect(body.family.publicFid).toBe('1042');
    expect(body.members).toHaveLength(1);
    expect(body.members[0].mid).toBe('FAM001ABCD12-01');
    // Member carries its 5-digit publicMid alongside the join-key `mid`.
    expect(body.members[0].publicMid).toBe('50001');
    expect(body.currentMid).toBe('FAM001ABCD12-01');
    expect(body.isManager).toBe(true);
  });

  it('returns 200 with isManager false for family-member', async () => {
    const res = await GET(makeRequest({ role: 'family-member', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-02' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isManager).toBe(false);
    expect(body.currentMid).toBe('FAM001ABCD12-02');
  });

  it('returns 401 when family document does not exist', async () => {
    mockGetFamilyByFid.mockResolvedValue(null);
    const res = await GET(makeRequest({ role: 'family-manager', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' }));
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
    const res = await GET(makeRequest({ role: 'family-manager', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' }));
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('PATCH /api/setu/family', () => {
  const manager = { role: 'family-manager', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-01' };
  const member = { role: 'family-member', fid: 'FAM001ABCD12', mid: 'FAM001ABCD12-02' };
  const validContact = { relation: 'Mother', phone: '+14165550111', email: 'mom@example.com' };

  it('returns 401 when no session headers', async () => {
    const res = await PATCH(makePatchRequest(undefined, { familyEmergencyContact: validContact }));
    expect(res.status).toBe(401);
  });

  it('writes the contact + revalidates + returns ok for a manager', async () => {
    const res = await PATCH(makePatchRequest(manager, { familyEmergencyContact: validContact }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      { familyEmergencyContact: validContact },
      { merge: true },
    );
    expect(revalidateTag).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('writes null to clear the contact', async () => {
    const res = await PATCH(makePatchRequest(manager, { familyEmergencyContact: null }));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      { familyEmergencyContact: null },
      { merge: true },
    );
  });

  it('returns 403 for a non-manager family member', async () => {
    const res = await PATCH(makePatchRequest(member, { familyEmergencyContact: validContact }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('not-manager');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid body (missing relation)', async () => {
    const res = await PATCH(makePatchRequest(manager, { familyEmergencyContact: { phone: '+14165550111' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('bad-request');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns 400 when familyEmergencyContact key is absent', async () => {
    const res = await PATCH(makePatchRequest(manager, {}));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
