import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
const readSession = vi.fn();
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: (r: Request) => readSession(r) }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

const getFamilyByFid = vi.fn();
vi.mock('@/features/setu/members/get-family-by-fid', () => ({
  getFamilyByFid: (...a: unknown[]) => getFamilyByFid(...a),
}));
const getState = vi.fn();
const record = vi.fn();
vi.mock('@/features/setu/disclaimers/acceptance', () => ({
  getDisclaimerStateForFamily: (...a: unknown[]) => getState(...a),
  recordDisclaimerAcceptance: (...a: unknown[]) => record(...a),
}));
const getConfig = vi.fn();
vi.mock('@/features/setu/disclaimers/config', () => ({ getDisclaimersConfig: (...a: unknown[]) => getConfig(...a) }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({ getSchoolYearConfig: async () => ({ currentYear: '2026-27' }) }));

import { GET } from '../route';
import { POST } from '../accept/route';

beforeEach(() => {
  readSession.mockReset(); getFamilyByFid.mockReset(); getState.mockReset(); record.mockReset(); getConfig.mockReset();
});

function req() { return new Request('http://x/api/setu/disclaimers'); }

describe('GET /api/setu/disclaimers', () => {
  it('401 with no session', async () => {
    readSession.mockReturnValue(null);
    expect((await GET(req())).status).toBe(401);
  });
  it('returns the family disclaimer state', async () => {
    readSession.mockReturnValue({ role: 'family-manager', fid: 'CMT-1', mid: 'm1' });
    getFamilyByFid.mockResolvedValue({ family: { disclaimersAccepted: null }, members: [] });
    getState.mockResolvedValue({ version: 3, schoolYear: '2026-27', sections: [], accepted: false });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 3, accepted: false });
  });
});

describe('POST /api/setu/disclaimers/accept', () => {
  it('records acceptance for the current version + year', async () => {
    readSession.mockReturnValue({ role: 'family-manager', fid: 'CMT-1', mid: 'm1' });
    getConfig.mockResolvedValue({ version: 3, sections: [] });
    const res = await POST(new Request('http://x/api/setu/disclaimers/accept', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 3 });
    expect(record).toHaveBeenCalledWith(expect.anything(), 'CMT-1', {
      version: 3, schoolYear: '2026-27', byMid: 'm1',
    });
  });
  it('401 without a fid', async () => {
    readSession.mockReturnValue({ role: 'family-manager', fid: null, mid: 'm1' });
    expect((await POST(new Request('http://x', { method: 'POST' }))).status).toBe(401);
  });
});
