import { describe, it, expect } from 'vitest';
import { buildGradeEligibleUnenrolled, type GradeEligibleCandidate } from '../grade-eligible';

const NOW = new Date('2026-10-01T12:00:00Z');

function child(over: Partial<GradeEligibleCandidate> & { mid: string }): GradeEligibleCandidate {
  return {
    fid: 'FAM-1',
    firstName: 'Kid',
    lastName: 'One',
    type: 'Child',
    schoolGrade: 'Grade 2',
    birthMonthYear: null,
    familyName: 'One family',
    ...over,
  };
}

// Level 2 covers grades 2 & 3 (west location shape).
const level2 = { levelKind: 'level' as const, gradeBand: ['2', '3'] };

describe('buildGradeEligibleUnenrolled', () => {
  it('includes a grade-matching child who is NOT enrolled (Vaibhav family6 case)', () => {
    const rows = buildGradeEligibleUnenrolled(level2, [child({ mid: 'FAM-6-03', firstName: 'Child1', lastName: 'Family6', schoolGrade: 'Grade 2' })], new Set(), NOW);
    expect(rows.map((r) => r.mid)).toEqual(['FAM-6-03']);
    expect(rows[0]).toMatchObject({ firstName: 'Child1', schoolGrade: 'Grade 2' });
  });

  it('excludes a child already in an active enrollment (on the enrolled roster)', () => {
    const rows = buildGradeEligibleUnenrolled(level2, [child({ mid: 'FAM-1-02' })], new Set(['FAM-1-02']), NOW);
    expect(rows).toEqual([]);
  });

  it("excludes a child whose grade is outside the level's band", () => {
    const rows = buildGradeEligibleUnenrolled(
      level2,
      [child({ mid: 'g5', schoolGrade: 'Grade 5' }), child({ mid: 'g2', schoolGrade: '2' })],
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.mid)).toEqual(['g2']); // Grade 5 excluded; "2" normalizes to match
  });

  it('normalizes grade tokens so "Grade 2" / "2" / "Gr 2" all match the band', () => {
    const rows = buildGradeEligibleUnenrolled(
      level2,
      [child({ mid: 'a', schoolGrade: 'Grade 2' }), child({ mid: 'b', schoolGrade: '2' }), child({ mid: 'c', schoolGrade: 'Gr 3' })],
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.mid).sort()).toEqual(['a', 'b', 'c']);
  });

  it('sorts by first name then last', () => {
    const rows = buildGradeEligibleUnenrolled(
      level2,
      [
        child({ mid: 'z', firstName: 'Zara', schoolGrade: '2' }),
        child({ mid: 'a', firstName: 'Aarav', schoolGrade: '3' }),
        child({ mid: 'm', firstName: 'Meera', schoolGrade: '2' }),
      ],
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.firstName)).toEqual(['Aarav', 'Meera', 'Zara']);
  });

  it('a child with no grade never matches a grade level', () => {
    const rows = buildGradeEligibleUnenrolled(level2, [child({ mid: 'x', schoolGrade: null })], new Set(), NOW);
    expect(rows).toEqual([]);
  });
});
