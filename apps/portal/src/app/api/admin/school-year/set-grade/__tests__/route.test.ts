import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetMemberGrade = vi.fn();
vi.mock('@/features/setu/rollover/set-member-grade', () => ({
  setMemberGrade: (...a: unknown[]) => mockSetMemberGrade(...a),
}));

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

function makeRequest(body?: unknown, role?: string, extraRoles?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (extraRoles) headers['x-portal-extra-roles'] = extraRoles;
  return new Request('http://localhost/api/admin/school-year/set-grade', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const VALID_BODY = { fid: 'CMT-0001', mid: 'CMT-0001-02', schoolGrade: '5' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSetMemberGrade.mockResolvedValue(true);
});

describe('POST /api/admin/school-year/set-grade', () => {
  it('returns 401 when there is no session header', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockSetMemberGrade).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin (welcome-team) role', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(VALID_BODY, 'welcome-team'));
    expect(res.status).toBe(403);
    expect(mockSetMemberGrade).not.toHaveBeenCalled();
  });

  it('returns 400 for an off-ladder grade', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ ...VALID_BODY, schoolGrade: '13' }, 'admin'));
    expect(res.status).toBe(400);
    expect(mockSetMemberGrade).not.toHaveBeenCalled();
  });

  it('returns 400 when fid is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ mid: 'CMT-0001-02', schoolGrade: '5' }, 'admin'));
    expect(res.status).toBe(400);
    expect(mockSetMemberGrade).not.toHaveBeenCalled();
  });

  it('returns 404 when setMemberGrade reports the member is absent', async () => {
    mockSetMemberGrade.mockResolvedValueOnce(false);
    const { POST } = await import('../route');
    const res = await POST(makeRequest(VALID_BODY, 'admin'));
    expect(res.status).toBe(404);
    expect(mockSetMemberGrade).toHaveBeenCalledTimes(1);
  });

  it('returns 200 and writes the grade for an admin', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(VALID_BODY, 'admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSetMemberGrade).toHaveBeenCalledWith(VALID_BODY);
  });

  it('returns 200 for a family-manager who also holds the admin capability via extraRoles', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(VALID_BODY, 'family-manager', 'admin'));
    expect(res.status).toBe(200);
    expect(mockSetMemberGrade).toHaveBeenCalledWith(VALID_BODY);
  });
});
