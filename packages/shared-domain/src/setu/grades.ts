import { GRADE_LADDER } from './grade-ladder';
// No cycle: grade-ladder.ts already imports this same module, and schemas/level
// imports neither of them (it inlines its own ladder order for exactly that
// reason). This is a diamond, not a loop.
import { normalizeGrade } from './schemas/level';

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

/** The canonical values under `normalizeGrade`, computed once. */
const NORMALIZED_CHILD_GRADES = new Set(CHILD_GRADE_VALUES.map((g) => normalizeGrade(g)));

/**
 * Is this a grade a child can legitimately be RECORDED with - i.e. one of the
 * canonical values under `normalizeGrade`?
 *
 * The looser sibling of `isChildGradeValue`, and the right check for a guest.
 * Level matching (`guestMatchesLevel`) compares `normalizeGrade(childGrade)`
 * against `normalizeGrade(band)`, so 'Grade 2', 'Gr 2', 'grade 2' and '2' are
 * all the same class - demanding the exact canonical token would reject three
 * spellings that work perfectly today, including the one the guest-route tests
 * have always sent.
 *
 * What it rejects is what no spelling can rescue: '', '3rd', 'grade three',
 * 'kindergarten', 'Grade 13'. Those normalize to nothing on the ladder, so the
 * child lands in "Not matched to a class" however many levels exist.
 *
 * ⚠️ It is NOT the same question as "will a class match this child". 'Shishu'
 * passes here and `guestMatchesLevel` can still never match it: that function
 * only considers `level`/`pre-level` kinds, so shishu classes are excluded by
 * design and those visitors are routed by in-class quick-add instead. Accepting
 * 'Shishu' is correct - a shishu-age guest must be recordable - but do not read
 * a promise about matching into the name.
 *
 * WRITE-path only, same as `CHILD_GRADE_VALUES` - never use it to validate a
 * READ.
 */
export function isMatchableChildGrade(value: string): boolean {
  return NORMALIZED_CHILD_GRADES.has(normalizeGrade(value));
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
