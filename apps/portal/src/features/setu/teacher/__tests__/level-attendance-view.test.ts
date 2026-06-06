import { it, expect, vi, beforeEach } from 'vitest';

const { mockDerive, mockDoor } = vi.hoisted(() => ({ mockDerive: vi.fn(), mockDoor: vi.fn() }));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({ readDoorPresentSids: mockDoor }));

import { getLevelAttendanceView } from '../level-attendance-view';

beforeEach(() => { mockDerive.mockReset(); mockDoor.mockReset(); });

it('resolves default-present with door overlay + portal precedence', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 1, total: 3,
    members: [
      { mid: 'F-02', fid: 'F', firstName: 'A', lastName: 'Z', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'absent', legacyFid: '4421', legacySid: 'S8' },
      { mid: 'F-03', fid: 'F', firstName: 'B', lastName: 'Y', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'unaccounted', legacyFid: '4421', legacySid: 'S9' },
      { mid: 'G-02', fid: 'G', firstName: 'C', lastName: 'X', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: '7000', legacySid: 'S1' },
    ],
  });
  mockDoor.mockResolvedValue(new Set(['S9'])); // only F-03 checked in at the door

  const view = await getLevelAttendanceView('L', '2026-01-04');
  expect(view).not.toBeNull();
  const byMid = Object.fromEntries(view!.rows.map((r) => [r.mid, r]));
  expect(byMid['F-02']).toMatchObject({ status: 'absent', source: 'portal', checkedInAtDoor: false });
  expect(byMid['F-03']).toMatchObject({ status: 'present', source: 'door', checkedInAtDoor: true });
  expect(byMid['G-02']).toMatchObject({ status: 'present', source: 'default', checkedInAtDoor: false });
  expect(view!.presentCount).toBe(2);
  expect(view!.total).toBe(3);
  expect(mockDoor).toHaveBeenCalledWith(['4421', '7000'], '2026-01-04'); // unique non-null legacyFids
});

it('returns null when the level is missing', async () => {
  mockDerive.mockResolvedValue(null);
  expect(await getLevelAttendanceView('nope', '2026-01-04')).toBeNull();
  expect(mockDoor).not.toHaveBeenCalled();
});

it('skips the door read when no roster member has a legacyFid', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 0, total: 1,
    members: [
      { mid: 'N-02', fid: 'N', firstName: 'New', lastName: 'Kid', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
  });
  const view = await getLevelAttendanceView('L', '2026-01-04');
  expect(view!.rows[0]).toMatchObject({ status: 'present', source: 'default', checkedInAtDoor: false });
  expect(view!.presentCount).toBe(1);
  expect(mockDoor).not.toHaveBeenCalled();
});
