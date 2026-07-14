import { describe, it, expect } from 'vitest';
import { GRADE_BAND_OPTIONS, CHILD_GRADE_OPTIONS, gradeLabel } from '../grades';

describe('grade options', () => {
  it('GRADE_BAND_OPTIONS is JK, SK, then Grade 1..12 in order (no Shishu, no 3K)', () => {
    expect(GRADE_BAND_OPTIONS.map((o) => o.value)).toEqual([
      'JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ]);
    expect(GRADE_BAND_OPTIONS.find((o) => o.value === '1')?.label).toBe('Grade 1');
    expect(GRADE_BAND_OPTIONS.find((o) => o.value === 'JK')?.label).toBe('JK');
  });

  it('CHILD_GRADE_OPTIONS prepends the Shishu age bucket', () => {
    expect(CHILD_GRADE_OPTIONS[0]).toEqual({ value: 'Shishu', label: 'Shishu (younger than JK)' });
    expect(CHILD_GRADE_OPTIONS.map((o) => o.value)).toEqual(['Shishu', ...GRADE_BAND_OPTIONS.map((o) => o.value)]);
  });
});

describe('gradeLabel', () => {
  it('prefixes numeric grades with "Grade"', () => {
    expect(gradeLabel('2')).toBe('Grade 2');
    expect(gradeLabel('10')).toBe('Grade 10');
  });
  it('leaves JK / SK / Shishu (short) as-is', () => {
    expect(gradeLabel('JK')).toBe('JK');
    expect(gradeLabel('SK')).toBe('SK');
    expect(gradeLabel('Shishu')).toBe('Shishu');
  });
  it('returns an already-labelled or unknown value unchanged, and empty for blank', () => {
    expect(gradeLabel('Grade 3')).toBe('Grade 3');
    expect(gradeLabel('')).toBe('');
    expect(gradeLabel(null)).toBe('');
    expect(gradeLabel(undefined)).toBe('');
  });
});
