import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const mockUpdate = vi.fn();
// Capture the doc/collection path so the test can prove the write is
// self-scoped (families/{fid}/members/{currentMid}), not just field-shaped.
const mockMemberDoc = vi.fn(() => ({ update: mockUpdate }));
const mockMembersCollection = vi.fn(() => ({ doc: mockMemberDoc }));
const mockFamilyDoc = vi.fn(() => ({ collection: mockMembersCollection }));
const mockTopCollection = vi.fn(() => ({ doc: mockFamilyDoc }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: mockTopCollection }),
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));

import { POST } from '../route';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

function makeRequest() {
  return new Request('http://localhost/api/setu/volunteering-skills/dismiss-nudge', { method: 'POST' });
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

describe('POST /api/setu/volunteering-skills/dismiss-nudge', () => {
  it('returns 401 when not signed in', async () => {
    (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('sets volunteeringSkillsNudgeDismissedAt on the current member only', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // self-scoped write: families/{fid}/members/{currentMid}
    expect(mockTopCollection).toHaveBeenCalledWith('families');
    expect(mockFamilyDoc).toHaveBeenCalledWith('CMT-AB12CD34');
    expect(mockMembersCollection).toHaveBeenCalledWith('members');
    expect(mockMemberDoc).toHaveBeenCalledWith('CMT-AB12CD34-02');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ volunteeringSkillsNudgeDismissedAt: { __serverTimestamp: true } }),
    );
  });

  it('returns 404 when the feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest());
    expect(res.status).toBe(404);
  });
});
