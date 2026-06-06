import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/seva/get-opportunities', () => ({ getOpportunity: vi.fn() }));
vi.mock('@/features/setu/seva/get-signups', () => ({
  getSignup: vi.fn(),
  listSignupsForOpp: vi.fn(),
  signupDocId: (oppId: string, fid: string) => `${oppId}__${fid}`,
  isActiveSignup: (s: { status: string }) => s.status === 'signed-up' || s.status === 'completed',
}));
const mockSet = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ set: mockSet }) }) }),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { POST } from '../route';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';
import { getSignup, listSignupsForOpp } from '@/features/setu/seva/get-signups';

function req(body?: unknown, role: string | null = 'family-member', fid: string | null = 'CMT-AB12CD34', mid: string | null = 'CMT-AB12CD34-01'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (fid) headers['x-portal-fid'] = fid;
  if (mid) headers['x-portal-mid'] = mid;
  return new Request('http://localhost/api/setu/seva/signups', { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const openOpp = { oppId: 'o1', status: 'open', sevaYear: '2025-26', capacity: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  vi.mocked(getOpportunity).mockResolvedValue(openOpp as never);
  vi.mocked(getSignup).mockResolvedValue(null);
  vi.mocked(listSignupsForOpp).mockResolvedValue([]);
});

describe('POST /api/setu/seva/signups', () => {
  it('401 no session', async () => { expect((await POST(req({ oppId: 'o1' }, null, null, null))).status).toBe(401); });
  it('400 missing fid', async () => { expect((await POST(req({ oppId: 'o1' }, 'family', null, null))).status).toBe(400); });
  it('400 bad body', async () => { expect((await POST(req({}))).status).toBe(400); });
  it('404 opportunity missing', async () => {
    vi.mocked(getOpportunity).mockResolvedValue(null);
    expect((await POST(req({ oppId: 'o1' }))).status).toBe(404);
  });
  it('409 not-open when closed', async () => {
    vi.mocked(getOpportunity).mockResolvedValue({ ...openOpp, status: 'closed' } as never);
    const res = await POST(req({ oppId: 'o1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not-open');
  });
  it('400 invalid-member when mid not in family', async () => {
    const res = await POST(req({ oppId: 'o1', mid: 'OTHER-01' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid-member');
  });
  it('idempotent 200 when already signed-up (no write)', async () => {
    vi.mocked(getSignup).mockResolvedValue({ signupId: 'o1__CMT-AB12CD34', status: 'signed-up' } as never);
    const res = await POST(req({ oppId: 'o1' }));
    expect(res.status).toBe(200);
    expect(mockSet).not.toHaveBeenCalled();
  });
  it('409 opportunity-full at capacity', async () => {
    vi.mocked(getOpportunity).mockResolvedValue({ ...openOpp, capacity: 1 } as never);
    vi.mocked(listSignupsForOpp).mockResolvedValue([{ signupId: 'o1__OTHER', status: 'signed-up' }] as never);
    const res = await POST(req({ oppId: 'o1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('opportunity-full');
  });
  it('201 creates the signup with member credit', async () => {
    const res = await POST(req({ oppId: 'o1', mid: 'CMT-AB12CD34-02' }));
    expect(res.status).toBe(201);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      signupId: 'o1__CMT-AB12CD34', oppId: 'o1', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02',
      sevaYear: '2025-26', status: 'signed-up', hoursAwarded: 0, signedUpByMid: 'CMT-AB12CD34-01',
    }));
  });
});
