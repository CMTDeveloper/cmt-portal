import { describe, it, expect } from 'vitest';
import { GRADE_BAND_OPTIONS, CHILD_GRADE_OPTIONS, CHILD_GRADE_VALUES, isChildGradeValue, gradeLabel } from '../grades';

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

// ── The WRITE-path guard ─────────────────────────────────────────────────────
// /register/family used a free-text grade input until 2026-07-29, so "E" was
// accepted (reported by Vaibhav). Replacing it with a <select> constrains only
// the portal's newest client - the register route still declared
// `schoolGrade: z.string().optional()`, so a stale tab, the mobile app, or any
// direct caller could keep writing junk. Found by a Codex review the same day.
describe('isChildGradeValue - write-path guard', () => {
  it('accepts every value the pickers actually offer', () => {
    for (const g of CHILD_GRADE_OPTIONS) expect(isChildGradeValue(g.value)).toBe(true);
  });

  it('accepts the age-based Shishu bucket, which is a real stored value', () => {
    expect(isChildGradeValue('Shishu')).toBe(true);
  });

  it('rejects the reported junk', () => {
    expect(isChildGradeValue('E')).toBe(false);
    expect(isChildGradeValue('3rd')).toBe(false);
    expect(isChildGradeValue('grade three')).toBe(false);
    expect(isChildGradeValue('')).toBe(false);
  });

  it('rejects a LABEL - the stored form is the token, and "Grade 3" is display only', () => {
    expect(isChildGradeValue('Grade 3')).toBe(false);
    expect(isChildGradeValue('3')).toBe(true);
  });

  it('is case- and space-exact, so a near-miss fails loudly rather than storing a second format', () => {
    expect(isChildGradeValue('jk')).toBe(false);
    expect(isChildGradeValue(' 3')).toBe(false);
    expect(isChildGradeValue('shishu')).toBe(false);
  });

  it('CHILD_GRADE_VALUES stays in step with the options list', () => {
    expect(CHILD_GRADE_VALUES).toEqual(CHILD_GRADE_OPTIONS.map((g) => g.value));
  });
});
