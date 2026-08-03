import { isParticipating } from '@cmt/shared-domain/setu';
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
    // A retired adult is not offered the class. Without this they stay
    // selectable and enrollable long after the family said they were done -
    // and the adult-class gate would keep asking the family to choose someone
    // who is no longer taking part.
    (m) => isCandidateAdult(m) && isParticipating(m) && !teacherAssignedMids.has(m.mid),
  );
}

/**
 * The adults the teaching rule removed from {@link selectableAdults} - shown on
 * the screen, greyed out and labelled as teaching, but never pickable.
 *
 * **This is a presentation list, NOT a selection list.** `selectableAdults`
 * remains the sole authority on who may be chosen, and the write route still
 * rejects any of these mids with `mid-not-selectable`. Nothing about the gate
 * changes: when every adult teaches, `selectableAdults` is empty and the gate
 * still never fires, so these rows are only ever seen alongside at least one
 * pickable adult.
 *
 * Originally this returned a bare COUNT, because the spec asked for the teaching
 * adult to be absent entirely. A real family then reported the obvious problem:
 * a household with two parents saw one name and read their own family record as
 * broken. Showing the adult greyed out, with the reason, answers the question
 * the absence raised. Reversed deliberately with CMT Developer, 2026-07-27.
 *
 * Returns only adults who would OTHERWISE have been offered, so a pending
 * invitee never appears here - they are absent for an entirely different reason,
 * and labelling them "teaching" would be a lie. Together with
 * `selectableAdults` this PARTITIONS the family's eligible adults: disjoint, and
 * covering, so nobody is shown twice and nobody silently disappears.
 */
export function teachingAdults(
  members: readonly MemberDoc[],
  teacherAssignedMids: ReadonlySet<string>,
): MemberDoc[] {
  return members.filter((m) => isCandidateAdult(m) && teacherAssignedMids.has(m.mid));
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
