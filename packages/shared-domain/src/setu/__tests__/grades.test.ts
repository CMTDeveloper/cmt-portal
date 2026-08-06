import { describe, it, expect } from 'vitest';
import {
  GRADE_BAND_OPTIONS, CHILD_GRADE_OPTIONS, CHILD_GRADE_VALUES,
  isChildGradeValue, isMatchableChildGrade, gradeLabel,
} from '../grades';
import { normalizeGrade } from '../schemas/level';

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

// The looser sibling, added for the guest write path (#130). A door/desk guest's
// grade is the ONLY thing routing them to a teacher, so the question that matters
// is not "is this the canonical token" but "can a class ever be matched to it" -
// which is what `guestMatchesLevel` asks, on both sides, through normalizeGrade.
describe('isMatchableChildGrade - the guest write-path guard', () => {
  it('accepts every value the pickers offer', () => {
    for (const g of CHILD_GRADE_OPTIONS) expect(isMatchableChildGrade(g.value)).toBe(true);
  });

  it('accepts the spellings isChildGradeValue rejects but a class still matches', () => {
    // The distinction this predicate exists for. These all normalize onto the
    // ladder, so `guestMatchesLevel` places the child in a real class - and the
    // guest routes' own fixtures have posted "Grade N" since they were written.
    // An exact-token check here would reject input that works in production.
    for (const spelling of ['Grade 3', 'grade 3', 'Gr 3', 'gr3', ' 3', '3']) {
      expect(isMatchableChildGrade(spelling), `${spelling} should be matchable`).toBe(true);
      expect(normalizeGrade(spelling)).toBe('3');
    }
    expect(isMatchableChildGrade('jk')).toBe(true);
    expect(isMatchableChildGrade('shishu')).toBe(true);
  });

  it('still rejects what genuinely reaches no teacher', () => {
    // Each of these normalizes to something absent from the ladder, so the child
    // lands in "Not matched to a class" however many levels exist.
    for (const junk of ['', '3rd', 'grade three', 'E', 'kindergarten', 'Grade 13']) {
      expect(isMatchableChildGrade(junk), `${junk} should NOT be matchable`).toBe(false);
    }
  });

  it('is strictly looser than isChildGradeValue, never narrower', () => {
    // A one-way implication, asserted rather than assumed: anything the exact
    // guard accepts must stay acceptable here, or tightening the guest routes
    // would silently break the member write path's canonical values.
    for (const g of CHILD_GRADE_VALUES) {
      expect(isChildGradeValue(g)).toBe(true);
      expect(isMatchableChildGrade(g)).toBe(true);
    }
    expect(isChildGradeValue('Grade 3')).toBe(false);
    expect(isMatchableChildGrade('Grade 3')).toBe(true);
  });
});
