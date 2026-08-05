import { z } from 'zod';

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

/** One guest child: name + grade (a CHILD_GRADE_OPTIONS value) so a teacher can
 *  match them to a class. Both required once a child row is added. */
export const GuestChildSchema = z.object({
  name: z.string().min(1),
  grade: z.string().min(1),
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
