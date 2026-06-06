import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/seva/get-signups', () => ({ getSignup: vi.fn() }));
const mockSet = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ set: mockSet }) }) }),
}));

import { POST } from '../route';
import { getSignup } from '@/features/setu/seva/get-signups';

function reqCtx(role: string | null = 'family-member', fid: string | null = 'CMT-AB12CD34') {
  const headers: Record<string, string> = {};
  if (role) headers['x-portal-role'] = role;
  if (fid) headers['x-portal-fid'] = fid;
  const req = new Request('http://localhost/api/setu/seva/signups/o1__CMT-AB12CD34/cancel', { method: 'POST', headers });
  return [req, { params: Promise.resolve({ signupId: 'o1__CMT-AB12CD34' }) }] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  vi.mocked(getSignup).mockResolvedValue({ signupId: 'o1__CMT-AB12CD34', fid: 'CMT-AB12CD34', status: 'signed-up' } as never);
});

describe('POST /api/setu/seva/signups/[signupId]/cancel', () => {
  it('401 no session', async () => { const [r, c] = reqCtx(null, null); expect((await POST(r, c)).status).toBe(401); });
  it('404 when missing', async () => { vi.mocked(getSignup).mockResolvedValue(null); const [r, c] = reqCtx(); expect((await POST(r, c)).status).toBe(404); });
  it('403 when a different family', async () => {
    vi.mocked(getSignup).mockResolvedValue({ signupId: 'x', fid: 'OTHER', status: 'signed-up' } as never);
    const [r, c] = reqCtx();
    expect((await POST(r, c)).status).toBe(403);
  });
  it('409 not-cancellable when already completed', async () => {
    vi.mocked(getSignup).mockResolvedValue({ signupId: 'x', fid: 'CMT-AB12CD34', status: 'completed' } as never);
    const [r, c] = reqCtx();
    expect((await POST(r, c)).status).toBe(409);
  });
  it('200 cancels (merge write)', async () => {
    const [r, c] = reqCtx();
    const res = await POST(r, c);
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith({ status: 'cancelled' }, { merge: true });
  });
});
