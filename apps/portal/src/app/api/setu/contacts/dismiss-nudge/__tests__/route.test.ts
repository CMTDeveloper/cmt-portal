import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const mockUpdate = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({
      doc: () => ({ collection: () => ({ doc: () => ({ update: mockUpdate }) }) }),
    }),
  }),
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));

import { POST } from '../route';

// The route authenticates from the middleware-set x-portal-* headers (cookie
// AND Bearer/mobile sessions). Pass session: null for a signed-out request.
const SIGNED_IN = { role: 'family-member', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' };

function makeRequest(session: typeof SIGNED_IN | null = SIGNED_IN) {
  const headers = new Headers();
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/contacts/dismiss-nudge', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
});

describe('POST /api/setu/contacts/dismiss-nudge', () => {
  it('returns 401 when not signed in', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(401);
  });

  it('sets contactsNudgeDismissedAt on the current member', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ contactsNudgeDismissedAt: { __serverTimestamp: true } }),
    );
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest());
    expect(res.status).toBe(404);
  });
});
