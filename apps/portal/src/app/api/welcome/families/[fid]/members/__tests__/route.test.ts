import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Staff add-a-member: POST /api/welcome/families/[fid]/members
 *
 * Exercised through the REAL write core against a fake Firestore rather than a
 * mocked `addMember`, because the two things most likely to be wrong here are
 * integration facts a mock would hide: that the write lands on the ROUTE's fid
 * (not the staff member's own), and that the shared required-field matrix
 * actually runs.
 */

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));
vi.mock('@/features/setu/ids/public-id-allocator', () => ({
  allocateMemberPublicIds: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, i) => String(50001 + i)),
  ),
}));
vi.mock('@/features/setu/enrollment/sync-enrollment-members', () => ({
  syncActiveEnrollmentMemberships: vi.fn(async () => ({ updated: [] })),
}));

import { POST } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { makeFakeDb, auditRows } from '@/features/setu/members/__tests__/fake-member-db';

const TARGET_FID = 'FAMTARGET001';
// The staff member's OWN family. A handler that reads fid from the session
// instead of the route param would write here, which is the bug this suite
// exists to catch.
const STAFF_FID = 'FAMSTAFF0002';

function staffHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-portal-role': 'welcome-team',
    'x-portal-uid': 'uid-staff',
    'x-portal-mid': `${STAFF_FID}-01`,
    'x-portal-fid': STAFF_FID,
    ...extra,
  };
}

/**
 * The realistic staff shape: welcome-team volunteers are usually parents, so
 * their PRIMARY role is family-manager and welcome-team rides in extraRoles. A
 * raw `x-portal-role === 'welcome-team'` comparison would 403 exactly the
 * people this feature is for.
 */
function volunteerParentHeaders(): Record<string, string> {
  return staffHeaders({
    'x-portal-role': 'family-manager',
    'x-portal-extra-roles': 'welcome-team',
  });
}

function makeRequest(body: unknown, headers: Record<string, string>) {
  return new Request(`http://localhost/api/welcome/families/${TARGET_FID}/members`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ fid: TARGET_FID }) };

const CHILD = {
  firstName: 'Diya',
  lastName: 'Patel',
  type: 'Child',
  gender: 'Female',
  foodAllergies: 'None',
  schoolGrade: 'Grade 5',
  birthMonthYear: '2015-05',
};

function useDb(docs: Record<string, unknown>) {
  const fake = makeFakeDb(docs);
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(fake.db);
  return fake;
}

function seed() {
  return {
    [`families/${TARGET_FID}`]: { fid: TARGET_FID, managers: [`${TARGET_FID}-01`] },
    [`families/${STAFF_FID}`]: { fid: STAFF_FID, managers: [`${STAFF_FID}-01`] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/welcome/families/[fid]/members', () => {
  it('returns 401 with no session', async () => {
    useDb(seed());
    const res = await POST(makeRequest(CHILD, { 'content-type': 'application/json' }), ctx);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a plain family-manager', async () => {
    useDb(seed());
    const res = await POST(
      makeRequest(CHILD, staffHeaders({ 'x-portal-role': 'family-manager' })),
      ctx,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  // Was "returns 403 for a coordinator" (spec 3.1 granted coordinator family
  // READ but not family EDIT). Reversed 2026-08-05: coordinator inherits the
  // whole welcome-team grant, so it reaches this handler like any other
  // welcome-team caller.
  it('returns 201 for a coordinator - it inherits welcome-team', async () => {
    useDb(seed());
    const res = await POST(makeRequest(CHILD, staffHeaders({ 'x-portal-role': 'coordinator' })), ctx);
    expect(res.status).toBe(201);
  });

  it('returns 201 for welcome-team', async () => {
    useDb(seed());
    const res = await POST(makeRequest(CHILD, staffHeaders()), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).mid).toBe(`${TARGET_FID}-01`);
  });

  it('returns 201 for a volunteer whose PRIMARY role is family-manager', async () => {
    useDb(seed());
    const res = await POST(makeRequest(CHILD, volunteerParentHeaders()), ctx);
    expect(res.status).toBe(201);
  });

  it('writes to the ROUTE fid, never the session fid', async () => {
    // Authority comes from the session, target comes from the route param, and
    // mixing them is the privilege boundary this whole feature turns on.
    const { writes } = useDb(seed());
    const res = await POST(makeRequest(CHILD, staffHeaders()), ctx);
    expect(res.status).toBe(201);

    expect(writes.some((w) => w.path.startsWith(`families/${TARGET_FID}/members/`))).toBe(true);
    expect(writes.some((w) => w.path.startsWith(`families/${STAFF_FID}/`))).toBe(false);
  });

  it('writes an audit row naming the staff member', async () => {
    const { writes } = useDb(seed());
    await POST(makeRequest(CHILD, staffHeaders()), ctx);

    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'member.create',
      actorUid: 'uid-staff',
      actorRole: 'welcome-team',
      fid: TARGET_FID,
    });
  });

  it('records the STAFF capability on the audit row, not just the primary role', async () => {
    // The realistic shape: a volunteer parent's primary role is family-manager,
    // so a row carrying only that - against another family's child - reads as a
    // family manager reaching across families, which is a security incident
    // rather than the routine staff work it actually is.
    const { writes } = useDb(seed());
    await POST(makeRequest(CHILD, volunteerParentHeaders()), ctx);

    expect(auditRows(writes)[0]).toMatchObject({
      actorRole: 'family-manager',
      actorExtraRoles: ['welcome-team'],
    });
  });

  it('returns 400 grade-required for a Child with no schoolGrade', async () => {
    // The shared matrix must run on the staff path too: a staff-created Child
    // with no grade immediately traps that family on /complete-profile.
    useDb(seed());
    const { schoolGrade: _dropped, ...rest } = CHILD;
    void _dropped;

    const res = await POST(makeRequest(rest, staffHeaders()), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('grade-required');
  });

  it('returns 404 for a family that does not exist', async () => {
    useDb({});
    const res = await POST(makeRequest(CHILD, staffHeaders()), ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the setu flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flagged } = await import('../route');
    const res = await flagged(makeRequest(CHILD, staffHeaders()), ctx);
    expect(res.status).toBe(404);
  });
});
