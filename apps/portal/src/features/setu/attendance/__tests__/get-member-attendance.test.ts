import { it, expect, vi, beforeEach } from 'vitest';

const { mockGetEvents, mockGetCheckIns } = vi.hoisted(() => ({
  mockGetEvents: vi.fn(),
  mockGetCheckIns: vi.fn(),
}));
vi.mock('@/features/setu/teacher/get-attendance', () => ({ getAttendanceForMember: mockGetEvents }));
vi.mock('../check-in-attendance', async (importOriginal) => {
  // keep the REAL summarizeMemberCheckIns; only stub the Firestore read.
  const actual = await importOriginal<typeof import('../check-in-attendance')>();
  return { ...actual, getCheckInAttendance: mockGetCheckIns };
});

import { getMemberUnifiedAttendance } from '../get-member-attendance';

beforeEach(() => { mockGetEvents.mockReset(); mockGetCheckIns.mockReset(); });

it('merges portal events (filtered by pid) with door check-ins for the member', async () => {
  mockGetEvents.mockResolvedValue([
    { aid: 'a1', mid: 'CMT-F1-02', fid: 'CMT-F1', levelId: 'L', pid: 'o-bv', date: '2026-01-04', status: 'late', isGuest: false },
    { aid: 'a2', mid: 'CMT-F1-02', fid: 'CMT-F1', levelId: 'L', pid: 'o-other', date: '2026-01-11', status: 'present', isGuest: false },
  ]);
  mockGetCheckIns.mockResolvedValue([
    { date: '2026-01-11', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
    { date: '2026-01-04', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
  ]);

  const out = await getMemberUnifiedAttendance({ mid: 'CMT-F1-02', legacyFid: '4421', legacySid: 'S9', pid: 'o-bv' });

  expect(out.marks).toEqual([
    { date: '2026-01-04', status: 'late', source: 'portal' },
    { date: '2026-01-11', status: 'present', source: 'door' },
  ]);
  expect(out).toMatchObject({ present: 1, late: 1, total: 2, attendedPct: 100 });
  expect(mockGetEvents).toHaveBeenCalledWith('CMT-F1-02');
  expect(mockGetCheckIns).toHaveBeenCalledWith('4421');
});

it('returns an empty summary when there is no legacySid and no portal events', async () => {
  mockGetEvents.mockResolvedValue([]);
  mockGetCheckIns.mockResolvedValue([]);
  const out = await getMemberUnifiedAttendance({ mid: 'CMT-F1-02', legacyFid: null, legacySid: null });
  expect(out).toMatchObject({ total: 0, marks: [] });
});
