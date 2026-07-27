import type { MemberDoc } from '@cmt/shared-domain/setu';

/**
 * The adults a family may choose from for the Adult Study Class.
 *
 * **"All adults" always means all NON-TEACHING adults** (spec 2.2 / 4.4). A
 * teacher-assigned adult is never offered, because they are running a class at
 * that hour. That single rule resolves scenario-matrix rows 3, 4 and 7 through
 * one mechanism - an empty result - rather than a literal "if both parents are
 * teachers" check, which would have handled row 3 and quietly missed 4 and 7.
 *
 * **PURE, and deliberately so.** Teacher assignment lives in Firestore
 * (`teacherAssignments/{mid}`, one doc read PER member via `isTeacherAssigned`),
 * so resolving it inside here would put an unbounded per-adult read behind every
 * caller - including the profile gate, which runs on every `/family/*` render.
 * The caller resolves the set once and passes it in.
 *
 * Order is the family's stored member order, unchanged: the UI preselects when
 * exactly one adult is selectable (row 5), and a stable order keeps a
 * multi-adult list from reshuffling between renders.
 *
 * This does NOT know about Bala Vihar. Row 6 - an adults-only household with no
 * BV enrollment - still returns selectable adults here; whether they are ever
 * *asked* is the gate's decision, and whether they pay is the fee rule's.
 */
export function selectableAdults(
  members: readonly MemberDoc[],
  teacherAssignedMids: ReadonlySet<string>,
): MemberDoc[] {
  return members.filter(
    (m) => isCandidateAdult(m) && !teacherAssignedMids.has(m.mid),
  );
}

/**
 * How many adults the teaching rule REMOVED from {@link selectableAdults}.
 *
 * §6.6 keeps a teaching adult out of the list entirely rather than showing them
 * unpickable, and that is right - but it means a household with two parents sees
 * one name and reads their own family record as broken. (A real family reported
 * exactly that.) This count lets the screen explain the absence.
 *
 * A COUNT, deliberately, never the members themselves: §6.6's requirement is
 * that the teaching adult not appear in the selection, and a caller handed the
 * records would be one `.map(name)` away from putting them back on the page.
 *
 * Counts only adults who would OTHERWISE have been offered, so a pending invitee
 * is never counted - they are absent for an entirely different reason, and
 * saying "someone is teaching" about them would be a lie.
 */
export function hiddenTeachingAdultCount(
  members: readonly MemberDoc[],
  teacherAssignedMids: ReadonlySet<string>,
): number {
  return members.filter((m) => isCandidateAdult(m) && teacherAssignedMids.has(m.mid)).length;
}

/** An adult who is eligible to be offered at all, before the teaching rule. */
function isCandidateAdult(m: MemberDoc): boolean {
  return (
    m.type === 'Adult' &&
    // A pending invitee is a placeholder record for someone who has not
    // accepted yet - not somebody who can be committed to attending a class.
    m.inviteStatus !== 'pending'
  );
}
