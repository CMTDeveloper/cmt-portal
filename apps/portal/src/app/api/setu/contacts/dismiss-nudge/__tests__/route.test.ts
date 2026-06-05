import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: vi.fn() }));
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
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

function makeRequest() {
  return new Request('http://localhost/api/setu/contacts/dismiss-nudge', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
  (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
    family: { fid: 'CMT-AB12CD34' },
    members: [{ mid: 'CMT-AB12CD34-02' }],
    currentMid: 'CMT-AB12CD34-02',
    isManager: false,
  });
});

describe('POST /api/setu/contacts/dismiss-nudge', () => {
  it('returns 401 when not signed in', async () => {
    (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest());
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
