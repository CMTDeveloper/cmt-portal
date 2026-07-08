import { describe, it, expect } from 'vitest';
import { matchChildLevel, type LevelForMatch } from '../derive-child-level';

// Brampton-shaped levels (subset), in doc order.
const LEVELS: LevelForMatch[] = [
  { levelId: 'shishu', levelName: 'Shishu Vihar', levelKind: 'shishu', gradeBand: [] },
  { levelId: 'pre-1', levelName: 'Pre-Level 1', levelKind: 'pre-level', gradeBand: ['JK', 'SK'] },
  { levelId: 'l1', levelName: 'Level 1', levelKind: 'level', gradeBand: ['1'] },
  { levelId: 'l2', levelName: 'Level 2', levelKind: 'level', gradeBand: ['2', '3'] },
  { levelId: 'l3', levelName: 'Level 3', levelKind: 'level', gradeBand: ['4', '5'] },
  { levelId: 'parents', levelName: 'Parents', levelKind: 'parents', gradeBand: [] },
];

const NOW = new Date('2026-09-15T12:00:00Z');
const child = (schoolGrade: string | null, birthMonthYear: string | null = null) =>
  ({ type: 'Child' as const, schoolGrade, birthMonthYear });

describe('matchChildLevel', () => {
  it('matches a Grade 2 child to Level 2 (band 2 & 3)', () => {
    expect(matchChildLevel(child('2'), LEVELS, NOW)).toEqual({ levelId: 'l2', levelName: 'Level 2' });
  });

  it('matches a Grade 3 child to the SAME Level 2 (shared band)', () => {
    expect(matchChildLevel(child('3'), LEVELS, NOW)).toEqual({ levelId: 'l2', levelName: 'Level 2' });
  });

  it('matches a Grade 1 child to Level 1', () => {
    expect(matchChildLevel(child('1'), LEVELS, NOW)).toEqual({ levelId: 'l1', levelName: 'Level 1' });
  });

  it('matches a Grade 4 child to Level 3 (band 4 & 5)', () => {
    expect(matchChildLevel(child('4'), LEVELS, NOW)).toEqual({ levelId: 'l3', levelName: 'Level 3' });
  });

  it('matches a JK child to the Pre-Level', () => {
    expect(matchChildLevel(child('JK'), LEVELS, NOW)).toEqual({ levelId: 'pre-1', levelName: 'Pre-Level 1' });
  });

  it('matches an adult to the Parents level', () => {
    expect(
      matchChildLevel({ type: 'Adult', schoolGrade: null, birthMonthYear: null }, LEVELS, NOW),
    ).toEqual({ levelId: 'parents', levelName: 'Parents' });
  });

  it('returns null when no level covers the grade (stays "Level pending")', () => {
    expect(matchChildLevel(child('12'), LEVELS, NOW)).toBeNull();
  });

  it('returns null for a child with an unknown grade', () => {
    expect(matchChildLevel(child(null), LEVELS, NOW)).toBeNull();
  });

  it('returns the FIRST matching level when bands overlap (doc order wins)', () => {
    const overlapping: LevelForMatch[] = [
      { levelId: 'a', levelName: 'A', levelKind: 'level', gradeBand: ['3'] },
      { levelId: 'b', levelName: 'B', levelKind: 'level', gradeBand: ['3'] },
    ];
    expect(matchChildLevel(child('3'), overlapping, NOW)).toEqual({ levelId: 'a', levelName: 'A' });
  });
});
