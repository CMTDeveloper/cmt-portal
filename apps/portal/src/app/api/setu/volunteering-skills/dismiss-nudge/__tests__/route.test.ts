import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const mockUpdate = vi.fn();
// Capture the doc/collection path so the test can prove the write is
// self-scoped (families/{fid}/members/{mid}), not just field-shaped.
const mockMemberDoc = vi.fn(() => ({ update: mockUpdate }));
const mockMembersCollection = vi.fn(() => ({ doc: mockMemberDoc }));
const mockFamilyDoc = vi.fn(() => ({ collection: mockMembersCollection }));
const mockTopCollection = vi.fn(() => ({ doc: mockFamilyDoc }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: mockTopCollection }),
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
  return new Request('http://localhost/api/setu/volunteering-skills/dismiss-nudge', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
});

describe('POST /api/setu/volunteering-skills/dismiss-nudge', () => {
  it('returns 401 when not signed in', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(401);
  });

  it('sets volunteeringSkillsNudgeDismissedAt on the current member only', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // self-scoped write: families/{fid}/members/{mid} from the session headers
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
