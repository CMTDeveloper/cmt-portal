import { describe, it, expect } from 'vitest';
import {
  balaViharSourceOidsForYear,
  buildLevelSnapshot,
  deriveNextSchoolYear,
  schoolYearDateRange,
  schoolYearOfDate,
  schoolYearOfPid,
  targetOidOf,
} from '../school-year';

describe('deriveNextSchoolYear', () => {
  it('derives the next school year label', () => {
    expect(deriveNextSchoolYear('2025-26')).toBe('2026-27');
    expect(deriveNextSchoolYear('2099-00')).toBe('2100-01');
  });

  it('rejects non-canonical labels', () => {
    expect(() => deriveNextSchoolYear('2025')).toThrow('Invalid school year');
    expect(() => deriveNextSchoolYear('2025-27')).toThrow('Invalid school year');
  });
});

describe('balaViharSourceOidsForYear', () => {
  it('builds the known Bala Vihar offering ids for a year', () => {
    expect(balaViharSourceOidsForYear('2026-27')).toEqual([
      'bv-brampton-2026-27',
      'bv-scarborough-2026-27',
    ]);
  });
});

describe('targetOidOf', () => {
  it('swaps the term in a bv oid, preserving prefix+location', () => {
    expect(targetOidOf('bv-brampton-2025-26', '2025-26', '2026-27')).toBe('bv-brampton-2026-27');
    expect(targetOidOf('bv-scarborough-2025-26', '2025-26', '2026-27')).toBe('bv-scarborough-2026-27');
  });
});

describe('buildLevelSnapshot', () => {
  const levels = [
    { levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2', levelKind: 'level' as const, gradeBand: ['2', '3'] },
    { levelId: 'brampton-shishu-vihar-bv-brampton-2025-26', levelName: 'Shishu Vihar', levelKind: 'shishu' as const, gradeBand: [] },
  ];
  const NOW = new Date('2026-06-07T00:00:00Z');
  it('matches a grade to a level snapshot', () => {
    const snap = buildLevelSnapshot({ schoolGrade: '3', birthMonthYear: null }, levels, NOW);
    expect(snap).toEqual({ schoolGrade: '3', levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2' });
  });
  it('returns null level when no band matches', () => {
    const snap = buildLevelSnapshot({ schoolGrade: '9', birthMonthYear: null }, levels, NOW);
    expect(snap).toEqual({ schoolGrade: '9', levelId: null, levelName: null });
  });
  it('matches shishu by age (null grade)', () => {
    const snap = buildLevelSnapshot({ schoolGrade: null, birthMonthYear: '2023-12' }, levels, NOW);
    expect(snap.levelName).toBe('Shishu Vihar');
    expect(snap.schoolGrade).toBeNull();
  });
});

describe('schoolYearDateRange', () => {
  it('maps "2025-26" to an Aug→Jul date-string window', () => {
    expect(schoolYearDateRange('2025-26')).toEqual({ start: '2025-08-01', end: '2026-07-31' });
  });
  it('throws on a malformed year', () => {
    expect(() => schoolYearDateRange('2025')).toThrow();
  });
});

describe('schoolYearOfDate', () => {
  it('maps a date in the start half (Sep) to its school year', () => {
    expect(schoolYearOfDate('2025-09-07')).toBe('2025-26');
  });
  it('keeps Jul 31 in the prior school year (before the Aug 1 boundary)', () => {
    expect(schoolYearOfDate('2026-07-31')).toBe('2025-26');
  });
  it('rolls Aug 1 forward into the next school year', () => {
    expect(schoolYearOfDate('2026-08-01')).toBe('2026-27');
  });
});

describe('schoolYearOfPid', () => {
  it('extracts the trailing school year from a bv pid', () => {
    expect(schoolYearOfPid('bv-brampton-2025-26')).toBe('2025-26');
  });
  it('throws when no school year is embedded', () => {
    expect(() => schoolYearOfPid('bv-brampton')).toThrow('no school year in pid');
  });
});
