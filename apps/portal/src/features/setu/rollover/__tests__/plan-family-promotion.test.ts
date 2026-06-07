import { it, expect } from 'vitest';
import { planFamilyPromotion } from '../plan-family-promotion';

const NOW = new Date('2026-06-07T00:00:00Z');
const srcLevels = [
  { levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2', levelKind: 'level' as const, gradeBand: ['2', '3'] },
  { levelId: 'brampton-level-3-bv-brampton-2025-26', levelName: 'Level 3', levelKind: 'level' as const, gradeBand: ['4', '5'] },
];
const tgtLevels = [
  { levelId: 'brampton-level-2-bv-brampton-2026-27', levelName: 'Level 2', levelKind: 'level' as const, gradeBand: ['2', '3'] },
  { levelId: 'brampton-level-3-bv-brampton-2026-27', levelName: 'Level 3', levelKind: 'level' as const, gradeBand: ['4', '5'] },
];

it('N=2: Gr2 stays Level 2, Gr3 → Level 3', () => {
  const plan = planFamilyPromotion({
    fid: 'F1', location: 'Brampton',
    enrolledMids: ['F1-02', 'F1-03'],
    members: [
      { mid: 'F1-02', firstName: 'A', lastName: 'R', type: 'Child', schoolGrade: '2', birthMonthYear: null },
      { mid: 'F1-03', firstName: 'B', lastName: 'R', type: 'Child', schoolGrade: '3', birthMonthYear: null },
    ],
    srcLevels, tgtLevels, now: NOW,
  });
  expect(plan.gradeUpdates).toEqual([
    { mid: 'F1-02', schoolGrade: '3' },
    { mid: 'F1-03', schoolGrade: '4' },
  ]);
  expect(plan.promotedMids).toEqual(['F1-02', 'F1-03']);
  expect(plan.sourceSnapshots['F1-02']).toEqual({ schoolGrade: '2', levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2' });
  expect(plan.targetSnapshots['F1-02']).toEqual({ schoolGrade: '3', levelId: 'brampton-level-2-bv-brampton-2026-27', levelName: 'Level 2' });
  expect(plan.targetSnapshots['F1-03']).toEqual({ schoolGrade: '4', levelId: 'brampton-level-3-bv-brampton-2026-27', levelName: 'Level 3' });
  expect(plan.rows.find(r => r.mid === 'F1-03')?.toLevelName).toBe('Level 3');
});

it('graduate (Gr12) is excluded from promotedMids but snapshotted', () => {
  const plan = planFamilyPromotion({
    fid: 'F2', location: 'Brampton', enrolledMids: ['F2-02'],
    members: [{ mid: 'F2-02', firstName: 'G', lastName: 'P', type: 'Child', schoolGrade: '12', birthMonthYear: null }],
    srcLevels: [{ levelId: 'l7', levelName: 'Level 7', levelKind: 'level' as const, gradeBand: ['11', '12'] }],
    tgtLevels, now: NOW,
  });
  expect(plan.promotedMids).toEqual([]);
  expect(plan.gradeUpdates).toEqual([]);
  expect(plan.rows[0]?.outcomeKind).toBe('graduate');
  expect(plan.sourceSnapshots['F2-02']?.levelName).toBe('Level 7');
});

it('needs-grade child is flagged, untouched', () => {
  const plan = planFamilyPromotion({
    fid: 'F3', location: 'Brampton', enrolledMids: ['F3-02'],
    members: [{ mid: 'F3-02', firstName: 'R', lastName: 'S', type: 'Child', schoolGrade: null, birthMonthYear: null }],
    srcLevels, tgtLevels, now: NOW,
  });
  expect(plan.promotedMids).toEqual([]);
  expect(plan.rows[0]?.outcomeKind).toBe('needs-grade');
});
