import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

const mockMark = vi.hoisted(() => vi.fn());
// The route now notifies on a real transition. getFamilyByFid is `use cache`d
// and throws "cacheTag() is only available with the cacheComponents config"
// under vitest, so it is stubbed along with the two notifiers.
const mockGetFamilyByFid = vi.hoisted(() => vi.fn());
const mockNotifyComplete = vi.hoisted(() => vi.fn());
const mockNotifyAbandoned = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: mockGetFamilyByFid }));
vi.mock('@/features/setu/donations/notify-donation-complete', () => ({ notifyDonationComplete: mockNotifyComplete }));
vi.mock('@/features/setu/donations/notify-donation-abandoned', () => ({ notifyDonationAbandoned: mockNotifyAbandoned }));
vi.mock('@/features/setu/donations/mark-donation-status', () => ({
  markDonationStatus: mockMark,
}));

import { POST } from '../route';

function makeRequest(
  did: string,
  body: unknown,
  session?: { role: string; fid: string; mid: string },
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  const req = new Request(`http://localhost/api/setu/donations/${did}/status`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { req, ctx: { params: Promise.resolve({ did }) } };
}

const MANAGER = { role: 'family-manager', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-01' };

beforeEach(() => {
  vi.clearAllMocks();
  // The RESULT OBJECT markDonationStatus returns since 2026-07-30, not a bare
  // boolean. The route destructures `{ ok }`, so a stale `true` here reads as
  // `ok: undefined` and 404s - which is exactly how this test caught the change.
  mockMark.mockResolvedValue({ ok: true, changed: true, previousStatus: 'pending' });
  mockGetFamilyByFid.mockReset();
  mockGetFamilyByFid.mockResolvedValue({ family: { fid: 'CMT-AB12CD34', managers: [], legacyFid: null }, members: [] });
  mockNotifyComplete.mockReset();
  mockNotifyComplete.mockResolvedValue(undefined);
  mockNotifyAbandoned.mockReset();
  mockNotifyAbandoned.mockResolvedValue(undefined);
});

describe('POST /api/setu/donations/[did]/status', () => {
  it('returns 403 for a non-manager family member', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, {
      role: 'family-member',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('returns 403 when no session', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
  });

  it('rejects an invalid status (cannot set redirected)', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'redirected' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('marks completed and passes the caller fid to the guard', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, status: 'completed' });
    expect(mockMark).toHaveBeenCalledWith('don-1', 'CMT-AB12CD34', 'completed');
  });

  it('returns 404 when the donation is unknown or belongs to another family', async () => {
    mockMark.mockResolvedValue({ ok: false, changed: false, previousStatus: null });
    const { req, ctx } = makeRequest('don-x', { status: 'abandoned' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  // ── The mobile client CONSUMES the transition, so it must also send ────────
  // These were entirely missing: a mobile payment won the `changed` transition
  // and no page render could ever recover it, so mobile families got no mail at
  // all. Found by a Codex review, 2026-07-30.
  it('sends the confirmation when a mobile client reports completed', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyComplete).toHaveBeenCalledTimes(1);
    expect(mockNotifyComplete.mock.calls[0]![0]).toMatchObject({ did: 'don-1', fid: 'CMT-AB12CD34' });
    expect(mockNotifyAbandoned).not.toHaveBeenCalled();
  });

  it('sends the pending notice when a mobile client reports abandoned', async () => {
    const { req, ctx } = makeRequest('don-1', { status: 'abandoned' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyAbandoned).toHaveBeenCalledTimes(1);
    expect(mockNotifyComplete).not.toHaveBeenCalled();
  });

  it('mails NOTHING when the status did not actually change', async () => {
    mockMark.mockResolvedValue({ ok: true, changed: false, previousStatus: 'completed' });
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, MANAGER);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyComplete).not.toHaveBeenCalled();
    expect(mockNotifyAbandoned).not.toHaveBeenCalled();
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const { req, ctx } = makeRequest('don-1', { status: 'completed' }, MANAGER);
    const res = await flaggedPOST(req, ctx);
    expect(res.status).toBe(404);
  });
});
