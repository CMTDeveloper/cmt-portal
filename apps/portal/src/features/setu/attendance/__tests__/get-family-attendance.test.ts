import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFamilyEvents, mockDoor } = vi.hoisted(() => ({ mockFamilyEvents: vi.fn(), mockDoor: vi.fn() }));
vi.mock('@/features/setu/teacher/get-attendance', () => ({ getAttendanceForFamily: mockFamilyEvents }));
vi.mock('../check-in-attendance', async () => {
  const actual = await vi.importActual<typeof import('../check-in-attendance')>('../check-in-attendance');
  return { ...actual, getCheckInAttendance: mockDoor };
});

import { getFamilyBalaViharAttendance } from '../get-family-attendance';

beforeEach(() => { vi.clearAllMocks(); });

const ARGS = {
  fid: 'CMT-F', legacyFid: '4421', oid: 'o-bv',
  windowStart: '2025-09-01', windowEnd: '2026-06-30',
  children: [
    { mid: 'CMT-F-02', legacySid: 'S8' },
    { mid: 'CMT-F-03', legacySid: 'S9' },
  ],
};

describe('getFamilyBalaViharAttendance', () => {
  it('N=2: a teacher-absent for one child never erases a sibling door-present on the same date', async () => {
    // Date D: child -02 teacher-marked ABSENT; child -03 door-checked-in PRESENT.
    mockFamilyEvents.mockResolvedValue([
      { aid: 'a', mid: 'CMT-F-02', fid: 'CMT-F', levelId: 'l', pid: 'o-bv', date: '2025-10-05', status: 'absent', isGuest: false },
    ]);
    mockDoor.mockResolvedValue([
      { date: '2025-10-05', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
    ]);
    const s = await getFamilyBalaViharAttendance(ARGS);
    // Family attended that Sunday because -03 was present, despite -02's absent.
    const d = s.marks.find((m) => m.date === '2025-10-05');
    expect(d?.status).toBe('present');
    expect(s.present).toBe(1);
    expect(s.total).toBe(1);
  });

  it('portal teacher mark wins over door for the SAME child', async () => {
    mockFamilyEvents.mockResolvedValue([
      { aid: 'a', mid: 'CMT-F-03', fid: 'CMT-F', levelId: 'l', pid: 'o-bv', date: '2025-10-12', status: 'late', isGuest: false },
    ]);
    mockDoor.mockResolvedValue([
      { date: '2025-10-12', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
    ]);
    const s = await getFamilyBalaViharAttendance(ARGS);
    const d = s.marks.find((m) => m.date === '2025-10-12');
    expect(d).toMatchObject({ status: 'late', source: 'portal' });
  });

  it('filters portal events to the offering oid and door records to the window', async () => {
    mockFamilyEvents.mockResolvedValue([
      { aid: 'a', mid: 'CMT-F-03', fid: 'CMT-F', levelId: 'l', pid: 'o-OTHER', date: '2025-10-19', status: 'present', isGuest: false }, // wrong oid → excluded
    ]);
    mockDoor.mockResolvedValue([
      { date: '2024-01-01', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] }, // before window → excluded
      { date: '2025-11-02', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] }, // in window
    ]);
    const s = await getFamilyBalaViharAttendance(ARGS);
    expect(s.marks.map((m) => m.date)).toEqual(['2025-11-02']);
    expect(s.present).toBe(1);
  });

  it('returns an empty summary when there are no children', async () => {
    mockFamilyEvents.mockResolvedValue([]);
    mockDoor.mockResolvedValue([]);
    const s = await getFamilyBalaViharAttendance({ ...ARGS, children: [] });
    expect(s).toEqual({ present: 0, late: 0, absent: 0, total: 0, attendedPct: 0, marks: [] });
  });
});
