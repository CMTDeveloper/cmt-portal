import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/seva/get-signups', () => ({ getSignup: vi.fn() }));
vi.mock('@/features/setu/seva/get-opportunities', () => ({ getOpportunity: vi.fn() }));
const mockSet = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ set: mockSet }) }) }),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { POST } from '../route';
import { getSignup } from '@/features/setu/seva/get-signups';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';

function req(body?: unknown, role: string | null = 'welcome-team', uid: string | null = 'w1'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  if (uid) headers['x-portal-uid'] = uid;
  return new Request('http://localhost/api/welcome/seva/signups/o1__F1/confirm', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const ctx = { params: Promise.resolve({ signupId: 'o1__F1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  vi.mocked(getSignup).mockResolvedValue({ signupId: 'o1__F1', oppId: 'o1', status: 'signed-up' } as never);
  vi.mocked(getOpportunity).mockResolvedValue({ oppId: 'o1', defaultHours: 3 } as never);
});

describe('POST /api/welcome/seva/signups/[signupId]/confirm', () => {
  it('401 when no session', async () => {
    expect((await POST(req({ status: 'completed' }, null, null), ctx)).status).toBe(401);
  });
  it('403 when role is family-member', async () => {
    expect((await POST(req({ status: 'completed' }, 'family-member'), ctx)).status).toBe(403);
  });
  it('400 bad body — invalid status', async () => {
    expect((await POST(req({ status: 'signed-up' }), ctx)).status).toBe(400);
  });
  it('400 bad body — empty object', async () => {
    expect((await POST(req({}), ctx)).status).toBe(400);
  });
  it('404 when signup missing', async () => {
    vi.mocked(getSignup).mockResolvedValue(null);
    expect((await POST(req({ status: 'completed' }), ctx)).status).toBe(404);
  });
  it('409 not-confirmable when signup is cancelled', async () => {
    vi.mocked(getSignup).mockResolvedValue({ signupId: 'o1__F1', oppId: 'o1', status: 'cancelled' } as never);
    const res = await POST(req({ status: 'completed' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not-confirmable');
  });
  it('200 completed with explicit hoursAwarded', async () => {
    const res = await POST(req({ status: 'completed', hoursAwarded: 5 }), ctx);
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', hoursAwarded: 5, confirmedBy: 'w1', confirmedAt: 'SERVER_TS' }),
      { merge: true },
    );
  });
  it('200 completed with no hours falls back to opportunity defaultHours', async () => {
    const res = await POST(req({ status: 'completed' }), ctx);
    expect(res.status).toBe(200);
    expect(getOpportunity).toHaveBeenCalledWith('o1');
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ hoursAwarded: 3 }), { merge: true });
  });
  it('200 no-show awards 0 hours and never reads the opportunity', async () => {
    const res = await POST(req({ status: 'no-show' }), ctx);
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'no-show', hoursAwarded: 0 }), { merge: true });
    expect(getOpportunity).not.toHaveBeenCalled();
  });
  it('200 re-confirms an already-completed signup (sevak fixes hours 5 -> 3)', async () => {
    // Spec: only a cancelled signup is blocked; a prior completed/no-show may be
    // re-confirmed to correct the awarded hours or flip the outcome.
    vi.mocked(getSignup).mockResolvedValue({ signupId: 'o1__F1', oppId: 'o1', status: 'completed', hoursAwarded: 5 } as never);
    const res = await POST(req({ status: 'completed', hoursAwarded: 3 }), ctx);
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', hoursAwarded: 3 }), { merge: true });
  });
});
