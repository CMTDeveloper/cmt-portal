import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SevakRow } from '@cmt/shared-domain';

const { mockRevokeRole, mockListSevaks, mockResolveContactIdentity } = vi.hoisted(() => ({
  mockRevokeRole: vi.fn(),
  mockListSevaks: vi.fn(),
  mockResolveContactIdentity: vi.fn(),
}));
vi.mock('@/features/setu/auth/manage-roles', () => ({
  revokeRole: mockRevokeRole,
  listSevaks: mockListSevaks,
  resolveContactIdentity: mockResolveContactIdentity,
  grantRole: vi.fn(),
}));

function makeRequest(body?: unknown, role = 'admin', uid = 'uid-caller', mid?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  if (mid) headers['x-portal-mid'] = mid;
  return new Request('http://localhost/api/admin/users/roles', {
    method: 'DELETE',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function sevakRow(over: Partial<SevakRow>): SevakRow {
  return {
    key: 'k',
    mid: null,
    fid: null,
    uid: null,
    name: 'X',
    contact: 'x@example.com',
    roles: [],
    isTeacher: false,
    teacherLevels: [],
    source: 'staff',
    ...over,
  };
}

// Two distinct admins so the last-admin guard does NOT trip by default.
const TWO_ADMINS: SevakRow[] = [
  sevakRow({ key: 'a1', uid: 'uid-a1', contact: 'a1@example.com', roles: ['admin'] }),
  sevakRow({ key: 'a2', uid: 'uid-a2', contact: 'a2@example.com', roles: ['admin'] }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRevokeRole.mockResolvedValue({ path: 'auth-claim', revoked: true });
  mockListSevaks.mockResolvedValue(TWO_ADMINS);
  // By default the target is someone OTHER than the caller.
  mockResolveContactIdentity.mockResolvedValue({ mid: null, uid: 'uid-other' });
});

describe('DELETE /api/admin/users/roles — auth', () => {
  it('denies welcome-team (403)', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'a@b.com', role: 'admin' }, 'welcome-team'));
    expect(res.status).toBe(403);
    expect(mockRevokeRole).not.toHaveBeenCalled();
  });

  it('returns 401 without a session role', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'a@b.com', role: 'admin' }, ''));
    expect(res.status).toBe(401);
  });

  it('rejects a bad body (400)', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'a@b.com', role: 'teacher' }));
    expect(res.status).toBe(400);
    expect(mockRevokeRole).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/roles — welcome-team revoke (no guards)', () => {
  it('revokes welcome-team without checking last-admin/self-lockout', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'a@b.com', role: 'welcome-team' }));
    expect(res.status).toBe(200);
    expect(mockResolveContactIdentity).not.toHaveBeenCalled();
    expect(mockListSevaks).not.toHaveBeenCalled();
    expect(mockRevokeRole).toHaveBeenCalledWith({ contact: 'a@b.com', role: 'welcome-team' });
  });
});

describe('DELETE /api/admin/users/roles — admin guards', () => {
  it('revokes admin from another person when >1 admin remains', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'a2@example.com', role: 'admin' }));
    expect(res.status).toBe(200);
    expect(mockRevokeRole).toHaveBeenCalledWith({ contact: 'a2@example.com', role: 'admin' });
  });

  it('409 self-lockout when the target uid matches the caller', async () => {
    mockResolveContactIdentity.mockResolvedValue({ mid: null, uid: 'uid-caller' });
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'me@example.com', role: 'admin' }, 'admin', 'uid-caller'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'self-lockout' });
    expect(mockRevokeRole).not.toHaveBeenCalled();
  });

  it('409 self-lockout when the target mid matches the caller mid', async () => {
    mockResolveContactIdentity.mockResolvedValue({ mid: 'CMT-FAM1-01', uid: 'uid-x' });
    const { DELETE } = await import('../route');
    const res = await DELETE(
      makeRequest({ contact: 'me@example.com', role: 'admin' }, 'admin', 'uid-caller', 'CMT-FAM1-01'),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'self-lockout' });
    expect(mockRevokeRole).not.toHaveBeenCalled();
  });

  it('409 last-admin when only one admin remains', async () => {
    mockListSevaks.mockResolvedValue([
      sevakRow({ key: 'only', uid: 'uid-only', contact: 'only@example.com', roles: ['admin'] }),
    ]);
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest({ contact: 'only@example.com', role: 'admin' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'last-admin' });
    expect(mockRevokeRole).not.toHaveBeenCalled();
  });
});
