import { it, expect, vi, beforeEach } from 'vitest';
const { mockDerive } = vi.hoisted(() => ({ mockDerive: vi.fn() }));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));
import { getLevelPreviousStudentsView } from '../previous-students-view';

beforeEach(() => mockDerive.mockReset());

it('maps previousStudents to rows (N=2, includes a two-sibling family)', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 2', ageLabel: 'Gr 2 & 3', location: 'Brampton', pid: 'o', date: '2026-01-18',
    members: [], total: 0, markedCount: 0, previousTotal: 3,
    previousStudents: [
      { mid: 'C-02', fid: 'C', firstName: 'Cara', lastName: 'Cherry', type: 'Child', schoolGrade: 'Grade 2', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'C-03', fid: 'C', firstName: 'Cody', lastName: 'Cherry', type: 'Child', schoolGrade: 'Grade 3', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'D-02', fid: 'D', firstName: 'Dan', lastName: 'Date', type: 'Child', schoolGrade: 'Grade 2', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
  });
  const view = await getLevelPreviousStudentsView('L', '2026-01-18');
  expect(view!.students.map((s) => s.mid)).toEqual(['C-02', 'C-03', 'D-02']);
  expect(view!.students[0]).toEqual({ mid: 'C-02', fid: 'C', firstName: 'Cara', lastName: 'Cherry', schoolGrade: 'Grade 2' });
});

it('returns null when the level is missing', async () => {
  mockDerive.mockResolvedValue(null);
  expect(await getLevelPreviousStudentsView('nope', '2026-01-18')).toBeNull();
});
