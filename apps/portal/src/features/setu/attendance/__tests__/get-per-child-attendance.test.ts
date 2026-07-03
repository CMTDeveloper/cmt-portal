import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFamilyEvents, mockDoor } = vi.hoisted(() => ({ mockFamilyEvents: vi.fn(), mockDoor: vi.fn() }));
vi.mock('@/features/setu/teacher/get-attendance', () => ({ getAttendanceForFamily: mockFamilyEvents }));
vi.mock('../check-in-attendance', async () => {
  const actual = await vi.importActual<typeof import('../check-in-attendance')>('../check-in-attendance');
  return { ...actual, getCheckInAttendance: mockDoor };
});

import { getPerChildBalaViharAttendance } from '../get-per-child-attendance';

beforeEach(() => {
  vi.clearAllMocks();
  mockDoor.mockResolvedValue([]);
});

describe('getPerChildBalaViharAttendance', () => {
  it('returns an independent present/total per child (N=2, one present one absent same day)', async () => {
    mockFamilyEvents.mockResolvedValue([
      { aid: 'a1', mid: 'K1', fid: 'FAM1', levelId: 'l', pid: 'oid-1', date: '2025-09-07', status: 'present', isGuest: false },
      { aid: 'a2', mid: 'K2', fid: 'FAM1', levelId: 'l', pid: 'oid-1', date: '2025-09-07', status: 'absent', isGuest: false },
      { aid: 'a3', mid: 'K1', fid: 'FAM1', levelId: 'l', pid: 'oid-1', date: '2025-09-14', status: 'late', isGuest: false },
    ]);

    const out = await getPerChildBalaViharAttendance({
      fid: 'FAM1', legacyFid: null, oid: 'oid-1',
      windowStart: '2025-09-01', windowEnd: '2026-06-15',
      children: [{ mid: 'K1', legacySid: null }, { mid: 'K2', legacySid: null }],
    });

    expect(out.get('K1')).toEqual({ present: 2, total: 2 }); // present + late both count as present
    expect(out.get('K2')).toEqual({ present: 0, total: 1 }); // one absent mark
  });

  it('ignores portal marks for a different oid', async () => {
    mockFamilyEvents.mockResolvedValue([
      { aid: 'a1', mid: 'K1', fid: 'FAM1', levelId: 'l', pid: 'other-oid', date: '2025-09-07', status: 'present', isGuest: false },
    ]);
    const out = await getPerChildBalaViharAttendance({
      fid: 'FAM1', legacyFid: null, oid: 'oid-1',
      windowStart: null, windowEnd: null, children: [{ mid: 'K1', legacySid: null }],
    });
    expect(out.get('K1')).toEqual({ present: 0, total: 0 });
  });
});
