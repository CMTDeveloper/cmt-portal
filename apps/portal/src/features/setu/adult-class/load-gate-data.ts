import 'server-only';
import { ADULT_STUDY_CLASS } from '@cmt/shared-domain';
import type { FamilyDoc, MemberDoc } from '@cmt/shared-domain/setu';
import {
  getOpenOfferingsForFamily,
  resolveCurrentOffering,
} from '@/features/setu/enrollment/get-open-offerings';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isTeacherAssigned } from '@/features/setu/teacher/assignments';
import { isLegacyBvPeriod } from '@/app/family/_helpers/dashboard-model';
import { selectableAdults } from './selectable-adults';
import type { AdultClassGateInput } from './needs-selection';

/** Nobody is a teacher yet - used to ask selectableAdults "who COULD be picked". */
const NOBODY: ReadonlySet<string> = new Set();

/**
 * Which of a family's members are assigned to teach.
 *
 * One `teacherAssignments` doc read per CANDIDATE - never per member. A child is
 * not a teacher-assignable person and a pending invitee cannot be chosen, so
 * neither is worth a read. Concurrent, so this is one round trip rather than N.
 *
 * The candidate list comes from `selectableAdults` itself (with nobody yet
 * marked as a teacher) rather than a re-implementation of "adult, not pending",
 * so the read set stays structurally tied to the predicate's own filter: change
 * who is selectable and this follows automatically instead of desyncing.
 *
 * Exported because the GENERIC enroll route needs the same set to derive
 * `enrolledMids`, and two hand-rolled definitions of "who teaches" would let the
 * two doors into the adult class enroll different people.
 */
export async function resolveTeacherAssignedMids(
  members: readonly MemberDoc[],
): Promise<ReadonlySet<string>> {
  const candidates = selectableAdults(members, NOBODY);
  if (candidates.length === 0) return NOBODY;
  const assigned = await Promise.all(candidates.map((m) => isTeacherAssigned(m.mid)));
  return new Set(candidates.filter((_, i) => assigned[i]).map((m) => m.mid));
}

export interface AdultClassGateSubject {
  family: FamilyDoc;
  members: readonly MemberDoc[];
  /** From the session via `getCurrentFamily()`. NOT derivable from `fid`. */
  isManager: boolean;
}

/**
 * The I/O half of the Adult Study Class gate: everything
 * `needsAdultClassSelection` needs, or `null` when the gate cannot apply.
 *
 * **`null` means "there is no adult-class question for this family."** Read
 * failures are NOT folded in here - they throw. See `loadAdultClassGateDataFailSoft`
 * for the gate's variant and why the two must stay distinguishable.
 *
 * **Takes the family, not a fid** (the plan said `(fid)`). `isManager` comes from
 * the session claims and cannot be derived from a fid at all, and the caller has
 * already loaded family+members from the React-`cache()`d `getCurrentFamily()`.
 * Same shape as `loadFamilyDashboard(family, members)`.
 *
 * **Read budget**, in the order they are spent, cheapest exits first:
 *
 * | Step | Cost | Skipped when |
 * |---|---|---|
 * | manager check | 0 | - |
 * | any adult could be picked | 0 | child-only / all-pending household |
 * | open offerings | 2 queries | either exit above fired |
 * | enrollments + donations | 1 query + 1 get/oid, + 1 query | no open offering |
 * | legacy roster | whole-roster RTDB read, `use cache`d | BV offering is not legacy-sourced |
 * | teacher assignment | **1 doc read per candidate adult** | - |
 *
 * Roughly 7-8 uncached Firestore ops on a gated family's every `/family/*`
 * render. `getFamilyByFid` is `use cache`d and `getCurrentFamily` is React
 * `cache()`d, so the caller's own reads are free; `getEnrollments` and
 * `getDonations` are NOT cached and are the real lever - a separate task, since
 * caching them changes `/family` too.
 */
export async function loadAdultClassGateDataOrThrow(
  subject: AdultClassGateSubject,
): Promise<AdultClassGateInput | null> {
  const { family, members, isManager } = subject;

  // Cheapest first: a non-manager fails condition 1, and a household with nobody
  // to pick fails condition 5. Both make the predicate false whatever else is
  // true, so returning early is equivalent - and it keeps every member render,
  // and every child-only family, at zero reads.
  if (!isManager) return null;

  // Ask selectableAdults itself who is even a candidate (with nobody yet marked
  // as a teacher) rather than re-implementing "adult, not pending" here. That
  // keeps the loader's read set structurally tied to the predicate's filter: a
  // future change to who is selectable flows through automatically instead of
  // desyncing against a copy of the rule.
  const candidates = selectableAdults(members, NOBODY);
  if (candidates.length === 0) return null;

  {
    // `location` is mapped with NO fallback at get-family-by-fid.ts:31, so it is
    // `undefined` at runtime for a doc that lacks it however FamilyDocSchema
    // types it. Normalize: getOpenOfferingsForFamily branches on `== null`, but
    // getOpenOfferings distinguishes `undefined` (no location filter at all)
    // from `null` (location-less only), and passing the wrong one there would
    // widen the query.
    const familyLocation = family.location ?? null;
    const offerings = await getOpenOfferingsForFamily(ADULT_STUDY_CLASS, familyLocation);
    const currentOffering = resolveCurrentOffering(offerings, familyLocation);
    // Condition 0 - no offering means no gate, and no reason to pay for the rest.
    if (!currentOffering) return null;

    const [enrollments, donations] = await Promise.all([
      getEnrollments(family.fid),
      getDonations(family.fid),
    ]);

    const [legacyPaymentStatus, teacherAssignedMids] = await Promise.all([
      // Only meaningful for a legacy-sourced Bala Vihar offering, and the read
      // is the ENTIRE prod RTDB roster - skip it otherwise. Same predicate
      // load-dashboard.ts:98 uses, so the two can't disagree about which
      // families the legacy leg applies to.
      isLegacyBvPeriod(enrollments)
        ? getLegacyPaymentStatus(family.legacyFid)
        : Promise.resolve('unknown'),
      resolveTeacherAssignedMids(members),
    ]);

    return {
      isManager,
      members,
      enrollments,
      donations,
      currentOffering,
      teacherAssignedMids,
      legacyPaymentStatus,
    };
  }
}

/**
 * `loadAdultClassGateDataOrThrow` with every read failure swallowed into `null`.
 *
 * **Neither of these two is named as the default, deliberately.** They return the
 * identical `Promise<AdultClassGateInput | null>`, so picking the wrong one
 * compiles clean and type-checks green - the mistake is invisible to everything
 * except a reader. A plain `loadAdultClassGateData` would have been the obvious
 * thing to reach for, and it would have been the WRONG one for a gate. Both
 * names now force the choice to be deliberate at every call site.
 *
 * **Only a GATE may use this.** The gate REDIRECTS and runs on every `/family/*`
 * render, so a transient Firestore error must cost the family an un-asked
 * question rather than a 500 across the whole portal - the same fail-soft
 * philosophy as `getLegacyPaymentStatus` (`legacy-payment.ts:71-74`) and
 * load-dashboard's cosmetic reads.
 *
 * **A screen that RENDERS must NOT use it**, and that is the entire reason the
 * two are separate functions. `/adult-class` is where the gate sends the family.
 * If it also collapsed a read failure to `null` and read that as "nothing to
 * select, go back to /family", an INTERMITTENT failure would bounce the two
 * routes off each other - the `ERR_TOO_MANY_REDIRECTS` shape this codebase has
 * already hit. Letting the throw reach `app/adult-class/error.tsx` gives the
 * family a real error with a retry instead of a loop.
 *
 * Note this catches strictly less than it looks: the two in-memory exits in
 * `loadAdultClassGateDataOrThrow` can only throw if a caller passes something that is
 * not a well-formed `MemberDoc[]`, which is a programming error that should fail
 * loudly rather than be laundered into "nothing to ask this family".
 */
export async function loadAdultClassGateDataFailSoft(
  subject: AdultClassGateSubject,
): Promise<AdultClassGateInput | null> {
  try {
    return await loadAdultClassGateDataOrThrow(subject);
  } catch (err) {
    console.error('[adult-class] gate data load failed - not gating this render', err);
    return null;
  }
}
