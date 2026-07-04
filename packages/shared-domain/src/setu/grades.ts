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
