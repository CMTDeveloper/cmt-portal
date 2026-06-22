import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SevakRow } from '@cmt/shared-domain';

const { mockGrantRole, mockListSevaks } = vi.hoisted(() => ({
  mockGrantRole: vi.fn(),
  mockListSevaks: vi.fn(),
}));
vi.mock('@/features/setu/auth/manage-roles', () => ({
  grantRole: mockGrantRole,
  listSevaks: mockListSevaks,
  // resolveContactIdentity/revokeRole are unused by GET/POST but mocked so the
  // module import resolves without pulling server-only deps.
  resolveContactIdentity: vi.fn(),
  revokeRole: vi.fn(),
}));

function makeRequest(method: string, body?: unknown, role = 'admin', uid = 'uid-admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/admin/users', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const SEVAKS: SevakRow[] = [
  {
    key: 'CMT-FAM1-01',
    mid: 'CMT-FAM1-01',
    fid: 'CMT-FAM1',
    uid: null,
    name: 'Asha Rao',
    contact: 'asha@example.com',
    roles: ['admin'],
    isTeacher: false,
    teacherLevels: [],
    source: 'family',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockListSevaks.mockResolvedValue(SEVAKS);
  mockGrantRole.mockResolvedValue({
    path: 'roleAssignments',
    mid: 'CMT-FAM1-01',
    fid: 'CMT-FAM1',
    uid: null,
  });
});

describe('GET /api/admin/users', () => {
  it('returns { sevaks } for an admin session', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, 'admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sevaks: SEVAKS });
    expect(mockListSevaks).toHaveBeenCalledTimes(1);
  });

  it('denies welcome-team (403)', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, 'welcome-team'));
    expect(res.status).toBe(403);
    expect(mockListSevaks).not.toHaveBeenCalled();
  });

  it('denies a family-manager (403)', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, 'family-manager'));
    expect(res.status).toBe(403);
  });

  it('returns 401 without a session role', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('GET', undefined, ''));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/users', () => {
  it('grants the role and returns 201', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { contact: 'asha@example.com', role: 'welcome-team' }));
    expect(res.status).toBe(201);
    expect(mockGrantRole).toHaveBeenCalledWith({ contact: 'asha@example.com', role: 'welcome-team' });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, role: 'welcome-team', path: 'roleAssignments' });
  });

  it('rejects a bad body (400, Zod)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { contact: 'asha@example.com', role: 'teacher' }));
    expect(res.status).toBe(400);
    expect(mockGrantRole).not.toHaveBeenCalled();
  });

  it('rejects an empty contact (400)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { contact: '', role: 'admin' }));
    expect(res.status).toBe(400);
  });

  it('returns 409 when the target contact is not a registered portal user', async () => {
    mockGrantRole.mockRejectedValue(
      Object.assign(new Error('registered-user-required'), {
        code: 'registered-user-required',
      }),
    );
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { contact: 'new@example.com', role: 'admin' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'registered-user-required' });
  });

  it('denies welcome-team (403)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { contact: 'a@b.com', role: 'admin' }, 'welcome-team'));
    expect(res.status).toBe(403);
    expect(mockGrantRole).not.toHaveBeenCalled();
  });
});
