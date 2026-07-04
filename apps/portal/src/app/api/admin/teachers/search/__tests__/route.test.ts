import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearchTeachers } = vi.hoisted(() => ({ mockSearchTeachers: vi.fn() }));
vi.mock('@/features/setu/teacher/search-teachers', () => ({ searchTeachers: mockSearchTeachers }));

function makeRequest(url: string, role?: string, uid?: string): Request {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost${url}`, { method: 'GET', headers });
}

const sampleHits = [{ mid: 'FAM-SH-01', name: 'Anil Sharma', email: 'anil@example.com', fid: 'FAM-SH', location: 'Brampton' }];

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchTeachers.mockResolvedValue(sampleHits);
});

describe('GET /api/admin/teachers/search', () => {
  it('401 when no session (missing role header)', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/teachers/search?q=Sharma'));
    expect(res.status).toBe(401);
    expect(mockSearchTeachers).not.toHaveBeenCalled();
  });

  it('admin GET ?q=Sharma → 200 {hits}', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/teachers/search?q=Sharma', 'admin', 'uid-a'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: sampleHits });
    expect(mockSearchTeachers).toHaveBeenCalledWith('Sharma');
  });

  it('welcome-team → 200 {hits}', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/teachers/search?q=Sharma', 'welcome-team', 'uid-w'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: sampleHits });
  });

  it('plain family (family-manager) → 403', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/teachers/search?q=Sharma', 'family-manager', 'uid-m'));
    expect(res.status).toBe(403);
    expect(mockSearchTeachers).not.toHaveBeenCalled();
  });

  it('empty q → {hits:[]} (searchTeachers called with "")', async () => {
    mockSearchTeachers.mockResolvedValue([]);
    const { GET } = await import('../route');
    const res = await GET(makeRequest('/api/admin/teachers/search', 'admin', 'uid-a'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: [] });
    expect(mockSearchTeachers).toHaveBeenCalledWith('');
  });
});
