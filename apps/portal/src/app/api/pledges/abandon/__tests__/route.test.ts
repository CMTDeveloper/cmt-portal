import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFlags, mockSubmission, mockCancel, mockFind } = vi.hoisted(() => ({
  mockFlags: { setuPledge: true },
  mockSubmission: vi.fn(),
  mockCancel: vi.fn(),
  mockFind: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({ flags: mockFlags }));
vi.mock('@/features/setu/pledges/stripe-pad-client', () => ({
  getCheckoutSessionSubmission: mockSubmission,
}));
vi.mock('@/features/setu/pledges/cancel-pledge', () => ({ cancelPledgeRecord: mockCancel }));
vi.mock('@/features/setu/pledges/find-started-pledge', () => ({ findStartedPledge: mockFind }));

import { POST } from '../route';

function req(headers: Record<string, string>) {
  return new Request('https://portal.test/api/pledges/abandon', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
}

const MANAGER = {
  'x-portal-role': 'family-manager',
  'x-portal-fid': 'CMT-A',
  'x-portal-mid': 'CMT-A-01',
  'x-portal-uid': 'uid-1',
};

/**
 * What `findStartedPledge` hands back. It returns the `started` row or null -
 * selecting it is the FEATURE's job (and its own tests'), so these tests state
 * the outcome rather than re-implementing the query.
 */
function seed(started: { pid: string; setupSessionId: string | null } | null) {
  mockFind.mockResolvedValue(started);
}

beforeEach(() => {
  mockFlags.setuPledge = true;
  mockFind.mockReset();
  seed({ pid: 'PLG-1', setupSessionId: 'cs_test_1' });
  mockSubmission.mockReset();
  mockSubmission.mockResolvedValue('not-submitted');
  mockCancel.mockReset();
  mockCancel.mockResolvedValue({ ok: true });
});

describe('POST /api/pledges/abandon', () => {
  it('clears an attempt Stripe says was never submitted', async () => {
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(200);
    expect(mockSubmission).toHaveBeenCalledWith('cs_test_1');
    expect(mockCancel).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 'PLG-1', actor: expect.objectContaining({ uid: 'uid-1' }) }),
    );
  });

  // 🔴 The one that matters. Clearing the record while a real mandate exists
  // lets the family authorise a SECOND one, and the portal can stop neither.
  it('REFUSES when the hosted page was submitted - a mandate may exist', async () => {
    mockSubmission.mockResolvedValue('submitted');
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'mandate-may-exist' });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('REFUSES when the provider cannot be asked - unknown is not permission', async () => {
    mockSubmission.mockRejectedValue(new Error('stripe says: customer cus_123 unreachable'));
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toBe('{"error":"provider-unavailable"}');
    // The provider message can name customers and payment state.
    expect(body).not.toContain('cus_123');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('clears without asking when the pledge never got a session id', async () => {
    // The provider call never landed at start, so nothing can exist to double.
    seed({ pid: 'PLG-2', setupSessionId: null });
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(200);
    expect(mockSubmission).not.toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ pid: 'PLG-2' }));
  });

  it('409s when nothing is in flight, rather than inventing something to cancel', async () => {
    seed(null);
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'nothing-to-abandon' });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('cancels exactly the pledge the feature named, never a guess', async () => {
    seed({ pid: 'PLG-STARTED', setupSessionId: 'cs_b' });
    await POST(req(MANAGER));
    expect(mockFind).toHaveBeenCalledWith('CMT-A');
    expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ pid: 'PLG-STARTED' }));
  });

  it('403s a non-manager - ending an attempt decides who starts the next', async () => {
    const res = await POST(req({ ...MANAGER, 'x-portal-role': 'family-member' }));
    expect(res.status).toBe(403);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('401s with no session, and 404s when the feature is dark', async () => {
    expect((await POST(req({}))).status).toBe(401);
    mockFlags.setuPledge = false;
    expect((await POST(req(MANAGER))).status).toBe(404);
  });

  it('passes through a lost race rather than reporting success', async () => {
    // The reconciler or an admin got there first; whatever they did stands.
    mockCancel.mockResolvedValue({ ok: false, reason: 'already-cancelled' });
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already-cancelled' });
  });
});
