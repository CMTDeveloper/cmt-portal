import { z } from 'zod';
import { programKeySchema } from './offering';

// Per-child snapshot of the grade/level for THIS enrollment's school year.
// Enables a child's Bala Vihar "journey" across years without a new collection.
export const LevelSnapshotSchema = z.object({
  schoolGrade: z.string().nullable(), // grade that year ("3","JK") or null for shishu
  levelId: z.string().nullable(),     // matched level id, or null if no match
  levelName: z.string().nullable(),   // denormalized for display ("Level 2","Shishu Vihar")
});
export type LevelSnapshot = z.infer<typeof LevelSnapshotSchema>;

export const EnrollmentDocSchema = z.object({
  eid: z.string().min(1),
  fid: z.string().min(1),
  oid: z.string().min(1),
  programKey: programKeySchema,
  programLabel: z.string().min(1),
  termLabel: z.string().min(1),
  location: z.string().min(1).nullable(),
  enrolledAt: z.date(),
  enrolledVia: z.enum(['family-initiated', 'first-attendance', 'welcome-team', 'promotion', 'kiosk']),
  enrolledByMid: z.string().nullable(),
  enrolledMids: z.array(z.string()),
  suggestedAmountSnapshot: z.number().int().nonnegative(),
  // `0` is meaningful, not "unset": it is how the Adult Study Class exemption is
  // persisted (a family that paid its Bala Vihar donation owes nothing, spec
  // 4.2). `positive()` made that rule unrepresentable. `null` still means "no
  // override, use the snapshot"; negatives stay rejected because an expected
  // amount below zero would read as the org owing the family money.
  suggestedAmountOverride: z.number().int().nonnegative().nullable(),
  /**
   * An admin has recorded that this enrollment's donation is collected OUTSIDE
   * the portal - a legacy pre-authorized debit, a cheque, cash at the office.
   * Written by the admin "mark paid off-portal" action and by nothing else.
   *
   * WHY IT EXISTS, given `suggestedAmountOverride: 0` already says "asks for
   * nothing": because 0 already meant something different first. The Adult
   * Study Class fee is WAIVED for a family who paid Bala Vihar, and that waiver
   * is stored as the same 0 (`api/setu/adult-class/route.ts`). Reusing the
   * value for settlement made the two facts indistinguishable, and every reader
   * had already picked the waiver reading - so a family an admin had just
   * marked paid showed on the welcome roster as "N/A" and disappeared from the
   * Paid filter. Vaibhav, 2026-08-04, on a real family: *"I marked this for
   * Sadeesh's family but in the roster I still don't see them paid"*.
   *
   * The two are different facts, not two spellings of one: a waiver means
   * nobody owes anything, a settlement means the money arrives somewhere this
   * system cannot see. Only the second one is "paid".
   *
   * Bare `.optional()`, never `.default()`: doc schemas validate on READ and
   * every enrollment written before 2026-08-04 lacks the field. Absent means
   * not settled. Who did it, when and why live in the `audit_log` row written
   * in the same transaction - this flag is only what the READERS need.
   */
  settledOffPortal: z.boolean().optional(),
  status: z.enum(['active', 'cancelled']),
  cancelledAt: z.date().nullable(),
  cancelledReason: z.string().nullable(),
  // Roster join key (deriveRoster queries where('pid','==',level.pid)). Optional
  // on read for back-compat; ALWAYS written going forward.
  pid: z.string().optional(),
  // Per-mid grade/level snapshot for this enrollment's year. Keyed by mid.
  levelSnapshots: z.record(z.string(), LevelSnapshotSchema).optional(),
  // How `enrolledMids` is maintained. 'auto' (the default when absent) lets the
  // member-edit sync re-derive the list from program eligibility; 'manual'
  // freezes an explicit family choice against that prune, so the adult the
  // family picked for the Adult Study Class is not silently replaced the next
  // time anyone edits a member.
  //
  // Bare .optional(), never .default(): doc schemas validate on READ, every
  // pre-existing enrollment lacks the field, and a default here would also make
  // partial writers erase it. Absence is interpreted as 'auto' by the consumer.
  membershipMode: z.enum(['auto', 'manual']).optional(),
});

export type EnrollmentDoc = z.infer<typeof EnrollmentDocSchema>;

export const PostEnrollmentBodySchema = z.object({
  oid: z.string().min(1),
});

export type PostEnrollmentBody = z.infer<typeof PostEnrollmentBodySchema>;

// POST /api/setu/adult-class - the family names which non-teaching adult(s)
// attend the Adult Study Class. `.strict()` because `fid` MUST come from the
// session: a body that silently carried one would let a manager write another
// family's enrollment. Duplicates are rejected rather than deduped - enrollFamily
// writes `enrolledMids` verbatim, so `['a','a']` would list the same person twice
// on the teacher roster, and a UI checkbox list cannot produce them anyway.
export const PostAdultClassBodySchema = z
  .object({
    mids: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((b) => new Set(b.mids).size === b.mids.length, {
    message: 'mids must not contain duplicates',
    path: ['mids'],
  });

export type PostAdultClassBody = z.infer<typeof PostAdultClassBodySchema>;

export const WelcomePostEnrollmentBodySchema = z.object({
  fid: z.string().min(1),
  oid: z.string().min(1),
});

export type WelcomePostEnrollmentBody = z.infer<typeof WelcomePostEnrollmentBodySchema>;

// CONTRACT WIDENING (2026-07-26): `0` was a 400 and is now accepted, so staff
// can deliberately zero an override on PATCH /api/welcome/enrollments/[eid]/override
// (previously only `null` — "remove the override" — or a positive amount).
// Negatives are still rejected.
export const OverrideEnrollmentBodySchema = z.object({
  suggestedAmountOverride: z.number().int().nonnegative().nullable(),
  /**
   * WHY this family's ask was changed. REQUIRED - deliberately not optional.
   *
   * Vaibhav, 2026-08-03, on marking legacy pre-authorized-debit donors as
   * settled: *"we have mark the enrollment manually... we can also add some
   * notes and record it probably"*.
   *
   * The note is the entire point of the audit row. An override with no reason
   * is indistinguishable from a mistake a year later, when the person who made
   * it has forgotten and the family is asking why they were never billed. A
   * `.optional()` here would mean the one field that makes the log worth
   * keeping is the one every caller can skip.
   *
   * Trimmed and length-bounded: `.min(3)` after trim rejects " " and "x",
   * which are the ways a required field gets defeated in practice; the max
   * keeps a pasted essay out of a Firestore document.
   */
  note: z.string().trim().min(3).max(500),
});

export type OverrideEnrollmentBody = z.infer<typeof OverrideEnrollmentBodySchema>;

export const ResolveActivePeriodParamsSchema = z.object({
  location: z.string().min(1),
  programKey: programKeySchema,
});

export type ResolveActivePeriodParams = z.infer<typeof ResolveActivePeriodParamsSchema>;
