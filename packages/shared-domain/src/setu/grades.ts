import { GRADE_LADDER } from './grade-ladder';

// The single canonical source for EVERY grade dropdown (owner's Bala Vihar level
// table, 2026-07-03). No '3K': the youngest tier is the age-based Shishu bucket.

/** Individual grade tokens an admin ticks to build a level's gradeBand
 *  (pre-level / level kinds). Labels follow the table: "JK", "SK", "Grade 1"… */
export const GRADE_BAND_OPTIONS: readonly { value: string; label: string }[] =
  GRADE_LADDER.map((g) => ({ value: g, label: /^\d/.test(g) ? `Grade ${g}` : g }));

/** Grades a CHILD can be in — the band tokens plus the age-based Shishu bucket
 *  (younger than JK). Used by the child profile + guest-add pickers. */
export const CHILD_GRADE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'Shishu', label: 'Shishu (younger than JK)' },
  ...GRADE_BAND_OPTIONS,
];

/**
 * The canonical child-grade values, for validating a WRITE.
 *
 * A dropdown is a convenience, never a rule: `/register/family` used a free-text
 * input until 2026-07-29 and the register route still declared
 * `schoolGrade: z.string().optional()`, so "E", "3rd" and "grade three" all
 * stored verbatim. Making the input a `<select>` fixed only the portal's own
 * newest client - a stale tab, the mobile app, or any direct caller could still
 * write junk that level assignment and the annual promotion cannot read.
 *
 * So the check belongs at the write route, which is the one place every caller
 * must pass through.
 *
 * ⚠️ For WRITES ONLY. Never use this to validate a READ: members registered
 * before the dropdown may legitimately hold a label like 'Grade 3', and refusing
 * to read those docs would lock those families out of their own profile. Display
 * goes through `gradeLabel()`, which tolerates both.
 */
export const CHILD_GRADE_VALUES: readonly string[] = CHILD_GRADE_OPTIONS.map((g) => g.value);

/** Is this exactly one of the canonical child-grade values? Write-path only. */
export function isChildGradeValue(value: string): boolean {
  return CHILD_GRADE_VALUES.includes(value);
}

/** Friendly label for a stored child grade value, for display next to a child's
 *  name. Numeric grades get a "Grade" prefix ('2' -> 'Grade 2'); JK/SK/Shishu
 *  and anything else stay as-is (a value already like 'Grade 2' is returned
 *  unchanged). Empty/null -> ''. */
export function gradeLabel(value: string | null | undefined): string {
  if (!value) return '';
  if (value === 'Shishu') return 'Shishu';
  return /^\d/.test(value) ? `Grade ${value}` : value;
}
