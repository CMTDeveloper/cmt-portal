import { z } from 'zod';
// Imported from the module, not the package barrel: `check-in` and `setu` are
// siblings and a barrel round-trip between them is how an import cycle starts.
import { isMatchableChildGrade } from '../setu/grades';

/**
 * The shape of a guest check-in, shared by the two routes that create one:
 * the door kiosk (`POST /api/check-in/guests`, self-serve) and the front desk
 * (`POST /api/welcome/visitors`, staff recording a walk-in).
 *
 * It lives here rather than inline in either route because the two write the
 * SAME collection and are read by the same screens. Two copies of a validation
 * schema over one document is how a field ends up required on one path and
 * optional on the other, and the reader cannot tell which produced a given row.
 */

/**
 * One guest child: name + grade so a teacher can match them to a class. Both
 * required once a child row is added.
 *
 * `grade` must be MATCHABLE, not merely non-empty. A grade that normalizes to
 * nothing on the ladder ('3rd', 'grade three', a typo) reaches no teacher for
 * exactly the same reason a blank one does not: `guestMatchesLevel` compares
 * `normalizeGrade(grade)` against each level's `gradeBand`, so the child lands
 * in the "Not matched to a class" bucket just as invisibly, and nobody at the
 * desk can tell the two cases apart. The dropdown alone cannot enforce this - a
 * stale tab or any direct caller posts whatever it likes - which is why the
 * check belongs here, at the write route every caller passes through.
 *
 * Deliberately `isMatchableChildGrade` and NOT the exact `isChildGradeValue`:
 * 'Grade 2' and '2' are the same class to the matcher, and these routes' own
 * tests have always posted the "Grade N" spelling. An exact check would have
 * rejected input that works today, which is a regression dressed as a tightening.
 *
 * WRITE-path only. Nothing validates a stored guest document with this schema,
 * and nothing should: refusing to READ an old row would erase guests from the
 * board rather than let anyone correct them.
 */
export const GuestChildSchema = z.object({
  name: z.string().min(1),
  grade: z.string().refine(isMatchableChildGrade, {
    message: 'grade must be one a class can be matched to (e.g. "2", "Grade 2", "JK", "Shishu")',
  }),
});

export const GuestCheckInSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Email + phone are REQUIRED so a checked-in guest family is reachable and can
  // later claim their account (Vaibhav). phone.min(7) mirrors registration.
  email: z.string().email(),
  phone: z.string().min(7),
  // Bounded, not just non-negative. Nothing downstream sanity-checks these, and
  // both feed screens that render per-row: an unbounded children array is an
  // unbounded teacher class list, and a five-digit adult count is a number that
  // appears verbatim on the visitors board. Generous enough that no real family
  // meets it.
  numberOfAdults: z.coerce.number().int().min(0).max(50),
  // Per-child name + grade (may be empty for an adults-only visit). The store
  // derives numberOfChildren from this.
  children: z.array(GuestChildSchema).max(20).default([]),
  notes: z.string().optional(),
});

export type GuestCheckInBody = z.infer<typeof GuestCheckInSchema>;

/**
 * What a child row looked like when the desk opened it for editing.
 *
 * Deliberately NOT `GuestChildSchema`: that requires both fields non-empty,
 * which is the right rule for CREATING a row and the wrong one for describing
 * an existing one. A child with a blank grade is precisely the row most in need
 * of correction - it is what the "Not matched to a class" bucket is full of -
 * so a snapshot that could not express "grade was blank" would make exactly the
 * rows this feature exists for un-editable.
 */
const GuestChildSnapshotSchema = z.object({
  name: z.string(),
  grade: z.string(),
});

/**
 * The VISIT's contact as the desk was shown it. Lax for the same reason as
 * above - a stored phone may be absent and normalizes to '' - and it is a
 * snapshot of what is, not a proposal for what should be.
 */
const GuestContactSnapshotSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string(),
});

/**
 * A correction to ONE child of an existing guest visit, from the front desk
 * (`PATCH /api/welcome/visitors`).
 *
 * `childIndex` addresses a position in the document's `children` array, because
 * those array elements have no id of their own. A positional address is only
 * safe with a compare-and-swap, which is what `expected` is: the desk sends what
 * it believes is there, and the write refuses if the document has moved on. Two
 * people at the desk on one Sunday morning is the normal case, not an exotic one.
 *
 * `contact` belongs to the VISIT, not to the child - one family checked in once.
 * Editing it from any child's row necessarily changes it for that visit's other
 * children, and the UI says so.
 *
 * ⚠️ `expected.contact` is REQUIRED, and covering it was not optional tidiness.
 * Every correction submits all four contact fields, so without a baseline to
 * compare against, a save that only touched a grade would still write back
 * whatever contact the form was holding - silently reverting a colleague's
 * email fix, with `lastEditedByUid` then attributing the reversion to the wrong
 * person. It is reachable by ONE person with two edit forms open on one visit,
 * which is the natural way to fix two siblings. The write uses this to decide
 * BOTH whether the contact may be written and whether it should be at all.
 *
 * The contact rules are PICKED from `GuestCheckInSchema` rather than restated,
 * so a field cannot end up required when adding a visitor and optional when
 * correcting one. Same reason this file exists at all.
 */
export const GuestUpdateSchema = z.object({
  id: z.string().min(1),
  // Upper bound mirrors `children`'s own .max(20): index 19 is the last element
  // a document is allowed to have, so anything beyond it addresses nothing.
  childIndex: z.number().int().min(0).max(19),
  expected: GuestChildSnapshotSchema.extend({ contact: GuestContactSnapshotSchema }),
  // The NEW values go through the same rule as creation: what you may write here
  // is exactly what you may write at the door. Non-empty grade is the point of
  // the feature - saving a blank one back would re-hide the child from teachers.
  child: GuestChildSchema,
  contact: GuestCheckInSchema.pick({
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
  }),
});

export type GuestUpdateBody = z.infer<typeof GuestUpdateSchema>;

/**
 * Normalize one stored `children[i]` field to the string the board displays.
 *
 * Both sides of the compare-and-swap MUST run this. The desk sends back the
 * value it was SHOWN, and the writer compares against the value it READS; if
 * those two normalizations ever drift, every correction fails as a phantom
 * conflict, or worse, a real conflict slips through. Stored grades are
 * `string | number` (the legacy door wrote numbers) and names may be absent.
 *
 * It lives in shared-domain rather than beside either caller because those
 * callers are in different portal features - `features/check-in` (the writer)
 * and `features/setu` (the reader) - which the boundaries lint forbids from
 * importing each other. This is exactly the "two consumers" case a shared
 * module is for.
 */
export function normalizeGuestChildField(value: unknown): string {
  return value == null ? '' : String(value).trim();
}
