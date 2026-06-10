import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

// ── prasad family-assignment feature mocks ────────────────────────────────────
const { getFamilyAssignment, getMoveOptions, moveAssignment } = vi.hoisted(() => ({
  getFamilyAssignment: vi.fn(),
  getMoveOptions: vi.fn(),
  moveAssignment: vi.fn(),
}));
vi.mock('@/features/setu/prasad/family-assignment', () => ({
  getFamilyAssignment,
  getMoveOptions,
  moveAssignment,
}));

function req(path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  return new Request(`https://x${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
// Family-manager session: role + fid + mid (mid is the actor passed to moveAssignment).
const MANAGER = { 'x-portal-role': 'family-manager', 'x-portal-extra-roles': '', 'x-portal-fid': 'CMT-0001', 'x-portal-mid': 'CMT-0001-01' };

const ASSIGNMENT = {
  paid: 'bv-brampton-2025-26-CMT-0001', pid: 'bv-brampton-2025-26', date: '2026-03-15',
  youngestName: 'Asha', birthMonth: 3, reason: 'birthday-month', status: 'assigned', movable: true,
};
const OPTIONS = { paid: 'bv-brampton-2025-26-CMT-0001', options: [{ date: '2026-03-22', seatsLeft: 2 }] };

beforeEach(() => {
  vi.clearAllMocks();
  getFamilyAssignment.mockResolvedValue(ASSIGNMENT);
  getMoveOptions.mockResolvedValue(OPTIONS);
  moveAssignment.mockResolvedValue('moved');
});

// ── GET /api/setu/prasad ────────────────────────────────────────────────────────
describe('GET /api/setu/prasad', () => {
  it('401 with no session header', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('/api/setu/prasad', { method: 'GET' }));
    expect(res.status).toBe(401);
    expect(getFamilyAssignment).not.toHaveBeenCalled();
  });

  it('200 returns { assignment } from the feature, bound to the session fid', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('/api/setu/prasad', { method: 'GET', headers: MANAGER }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assignment: ASSIGNMENT });
    expect(getFamilyAssignment).toHaveBeenCalledWith('CMT-0001');
  });

  it('200 returns { assignment: null } when the family has none', async () => {
    getFamilyAssignment.mockResolvedValue(null);
    const { GET } = await import('../route');
    const res = await GET(req('/api/setu/prasad', { method: 'GET', headers: MANAGER }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assignment: null });
  });
});

// ── GET /api/setu/prasad/options ──────────────────────────────────────────────
describe('GET /api/setu/prasad/options', () => {
  it('401 with no session header', async () => {
    const { GET } = await import('../options/route');
    const res = await GET(req('/api/setu/prasad/options', { method: 'GET' }));
    expect(res.status).toBe(401);
    expect(getMoveOptions).not.toHaveBeenCalled();
  });

  it('200 returns the feature result, bound to the session fid', async () => {
    const { GET } = await import('../options/route');
    const res = await GET(req('/api/setu/prasad/options', { method: 'GET', headers: MANAGER }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OPTIONS);
    expect(getMoveOptions).toHaveBeenCalledWith('CMT-0001');
  });

  it('200 returns the empty shape when the feature returns null', async () => {
    getMoveOptions.mockResolvedValue(null);
    const { GET } = await import('../options/route');
    const res = await GET(req('/api/setu/prasad/options', { method: 'GET', headers: MANAGER }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paid: null, options: [] });
  });
});

// ── POST /api/setu/prasad/move ────────────────────────────────────────────────
describe('POST /api/setu/prasad/move', () => {
  it('401 with no session header', async () => {
    const { POST } = await import('../move/route');
    const res = await POST(req('/api/setu/prasad/move', { method: 'POST', body: { date: '2026-03-22' } }));
    expect(res.status).toBe(401);
    expect(moveAssignment).not.toHaveBeenCalled();
  });

  it('400 on a malformed date', async () => {
    const { POST } = await import('../move/route');
    const res = await POST(req('/api/setu/prasad/move', { method: 'POST', body: { date: 'nope' }, headers: MANAGER }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad-request' });
    expect(moveAssignment).not.toHaveBeenCalled();
  });

  it('200 { ok: true } when the move succeeds (passes fid + date + actor=mid)', async () => {
    const { POST } = await import('../move/route');
    const res = await POST(req('/api/setu/prasad/move', { method: 'POST', body: { date: '2026-03-22' }, headers: MANAGER }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(moveAssignment).toHaveBeenCalledWith('CMT-0001', '2026-03-22', 'CMT-0001-01');
  });

  it('404 { error: not-found } when there is no assignment', async () => {
    moveAssignment.mockResolvedValue('not-found');
    const { POST } = await import('../move/route');
    const res = await POST(req('/api/setu/prasad/move', { method: 'POST', body: { date: '2026-03-22' }, headers: MANAGER }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });

  it.each(['locked', 'target-full', 'invalid-target'] as const)(
    '409 { error: %s } on a conflict result',
    async (result) => {
      moveAssignment.mockResolvedValue(result);
      const { POST } = await import('../move/route');
      const res = await POST(req('/api/setu/prasad/move', { method: 'POST', body: { date: '2026-03-22' }, headers: MANAGER }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: result });
    },
  );
});
