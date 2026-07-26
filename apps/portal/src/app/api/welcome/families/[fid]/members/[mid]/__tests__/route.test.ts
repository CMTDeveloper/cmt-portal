import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Staff edit/remove a member: /api/welcome/families/[fid]/members/[mid]
 *
 * Runs the REAL write core against a fake Firestore, so the last-manager guard
 * and the required-field matrix are genuinely exercised on the staff path
 * rather than assumed to be reachable.
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
vi.mock('@/features/setu/enrollment/sync-enrollment-members', () => ({
  syncActiveEnrollmentMemberships: vi.fn(async () => ({ updated: [] })),
}));
const mockRevokeMemberSessions = vi.hoisted(() => vi.fn(async () => ({ uids: [] })));
// RESURRECTABLE_SEVAK_CAPS is DERIVED from the real GRANTABLE_ROLES, never a
// hardcoded copy: a hardcoded list keeps this suite green while the production
// strip-list silently fails to cover a newly grantable role.
vi.mock('@/features/setu/auth/revoke-sessions', async () => {
  const { GRANTABLE_ROLES } = await vi.importActual<typeof import('@cmt/shared-domain')>(
    '@cmt/shared-domain',
  );
  return { revokeMemberSessions: mockRevokeMemberSessions, RESURRECTABLE_SEVAK_CAPS: [...GRANTABLE_ROLES] };
});

import { PATCH, DELETE } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { makeFakeDb, auditRows } from '@/features/setu/members/__tests__/fake-member-db';

const TARGET_FID = 'FAMTARGET001';
const STAFF_FID = 'FAMSTAFF0002';
const TARGET_MID = `${TARGET_FID}-02`;

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

function volunteerParentHeaders(): Record<string, string> {
  return staffHeaders({ 'x-portal-role': 'family-manager', 'x-portal-extra-roles': 'welcome-team' });
}

function makeRequest(method: 'PATCH' | 'DELETE', body: unknown, headers: Record<string, string>) {
  return new Request(`http://localhost/api/welcome/families/${TARGET_FID}/members/${TARGET_MID}`, {
    method,
    headers,
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: Promise.resolve({ fid: TARGET_FID, mid: TARGET_MID }) };

const CHILD_DOC = {
  mid: TARGET_MID,
  type: 'Child',
  manager: false,
  gender: 'Female',
  firstName: 'Diya',
  lastName: 'Patel',
  email: null,
  phone: null,
  schoolGrade: 'Grade 5',
  birthMonthYear: '2015-05',
  volunteeringSkills: [],
  foodAllergies: 'None',
};

function useDb(docs: Record<string, unknown>) {
  const fake = makeFakeDb(docs);
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue(fake.db);
  return fake;
}

function seed(extra: Record<string, unknown> = {}) {
  return {
    [`families/${TARGET_FID}`]: { fid: TARGET_FID, managers: [`${TARGET_FID}-01`] },
    [`families/${TARGET_FID}/members/${TARGET_MID}`]: CHILD_DOC,
    [`families/${STAFF_FID}`]: { fid: STAFF_FID, managers: [`${STAFF_FID}-01`] },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/welcome/families/[fid]/members/[mid]', () => {
  it('returns 401 with no session', async () => {
    useDb(seed());
    const res = await PATCH(
      makeRequest('PATCH', { schoolGrade: 'Grade 6' }, { 'content-type': 'application/json' }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for a plain family-manager', async () => {
    useDb(seed());
    const res = await PATCH(
      makeRequest('PATCH', { schoolGrade: 'Grade 6' }, staffHeaders({ 'x-portal-role': 'family-manager' })),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for a coordinator', async () => {
    useDb(seed());
    const res = await PATCH(
      makeRequest('PATCH', { schoolGrade: 'Grade 6' }, staffHeaders({ 'x-portal-role': 'coordinator' })),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 for welcome-team and writes to the ROUTE fid', async () => {
    const { writes } = useDb(seed());
    const res = await PATCH(makeRequest('PATCH', { schoolGrade: 'Grade 6' }, staffHeaders()), ctx);

    expect(res.status).toBe(200);
    expect(writes.some((w) => w.path === `families/${TARGET_FID}/members/${TARGET_MID}`)).toBe(true);
    expect(writes.some((w) => w.path.startsWith(`families/${STAFF_FID}/`))).toBe(false);
  });

  it('returns 200 for a volunteer whose PRIMARY role is family-manager', async () => {
    useDb(seed());
    const res = await PATCH(makeRequest('PATCH', { schoolGrade: 'Grade 6' }, volunteerParentHeaders()), ctx);
    expect(res.status).toBe(200);
  });

  it('writes an audit row with both sides of the change', async () => {
    const { writes } = useDb(seed());
    await PATCH(makeRequest('PATCH', { schoolGrade: 'Grade 6' }, staffHeaders()), ctx);

    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'member.update',
      actorUid: 'uid-staff',
      fid: TARGET_FID,
      mid: TARGET_MID,
      after: { schoolGrade: 'Grade 6' },
    });
    expect((rows[0] as { before: Record<string, unknown> }).before).toMatchObject({
      schoolGrade: 'Grade 5',
    });
  });

  it('returns 400 grade-required when staff clears a Child grade', async () => {
    useDb(seed());
    const res = await PATCH(makeRequest('PATCH', { schoolGrade: null }, staffHeaders()), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('grade-required');
  });

  it('returns 404 for a member that does not exist', async () => {
    useDb({ [`families/${TARGET_FID}`]: { fid: TARGET_FID, managers: [] } });
    const res = await PATCH(makeRequest('PATCH', { schoolGrade: 'Grade 6' }, staffHeaders()), ctx);
    expect(res.status).toBe(404);
  });

  it('refuses to demote the last manager', async () => {
    // The guard must hold on the staff path too: a family with no manager can
    // never be administered by anyone again.
    useDb({
      [`families/${TARGET_FID}`]: { fid: TARGET_FID, managers: [TARGET_MID] },
      [`families/${TARGET_FID}/members/${TARGET_MID}`]: {
        ...CHILD_DOC,
        type: 'Adult',
        manager: true,
        email: 'm@example.com',
        phone: '4165550000',
        volunteeringSkills: ['Teaching / Facilitation'],
      },
    });

    const res = await PATCH(makeRequest('PATCH', { manager: false }, staffHeaders()), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('last-manager');
  });
});

describe('DELETE /api/welcome/families/[fid]/members/[mid]', () => {
  it('returns 401 with no session', async () => {
    useDb(seed());
    const res = await DELETE(makeRequest('DELETE', null, { 'content-type': 'application/json' }), ctx);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a plain family-manager', async () => {
    useDb(seed());
    const res = await DELETE(
      makeRequest('DELETE', null, staffHeaders({ 'x-portal-role': 'family-manager' })),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('removes the member from the ROUTE family and audits it', async () => {
    const { writes, deletes } = useDb(seed());
    const res = await DELETE(makeRequest('DELETE', null, staffHeaders()), ctx);

    expect(res.status).toBe(200);
    expect(deletes).toContain(`families/${TARGET_FID}/members/${TARGET_MID}`);
    const rows = auditRows(writes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'member.delete', fid: TARGET_FID, mid: TARGET_MID, after: null });
  });

  it('refuses to remove the last manager', async () => {
    useDb({
      [`families/${TARGET_FID}`]: { fid: TARGET_FID, managers: [TARGET_MID] },
      [`families/${TARGET_FID}/members/${TARGET_MID}`]: { ...CHILD_DOC, manager: true },
    });

    const res = await DELETE(makeRequest('DELETE', null, staffHeaders()), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('last-manager');
  });

  it('returns 404 for a member that does not exist', async () => {
    useDb({ [`families/${TARGET_FID}`]: { fid: TARGET_FID, managers: [] } });
    const res = await DELETE(makeRequest('DELETE', null, staffHeaders()), ctx);
    expect(res.status).toBe(404);
  });
});
