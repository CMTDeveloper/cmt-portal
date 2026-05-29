import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const chain = { where: () => chain, orderBy: () => chain, get: mockGet };
  return { portalFirestore: () => ({ collection: () => chain }) };
});

import { summarize, getAttendanceForMember, getAttendanceForFamily } from '../get-attendance';

describe('summarize', () => {
  it('counts statuses and computes attended% (present+late)/total', () => {
    const s = summarize([
      { status: 'present' }, { status: 'present' }, { status: 'late' }, { status: 'absent' },
    ]);
    expect(s).toEqual({ present: 2, late: 1, absent: 1, total: 4, attendedPct: 75 });
  });
  it('returns 0% for an empty set', () => {
    expect(summarize([])).toEqual({ present: 0, late: 0, absent: 0, total: 0, attendedPct: 0 });
  });
});

describe('getAttendanceForMember / Family', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps member records', async () => {
    mockGet.mockResolvedValue({
      docs: [{ data: () => ({ aid: 'a1', mid: 'M', fid: 'F', levelId: 'L', pid: 'P', date: '2025-09-07', status: 'present', isGuest: false }) }],
    });
    const out = await getAttendanceForMember('M');
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('present');
  });

  it('maps family records and defaults isGuest', async () => {
    mockGet.mockResolvedValue({
      docs: [{ data: () => ({ aid: 'a1', mid: 'M', fid: 'F', levelId: 'L', pid: 'P', date: '2025-09-07', status: 'late' }) }],
    });
    const out = await getAttendanceForFamily('F');
    expect(out[0]!.isGuest).toBe(false);
  });
});
