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
 * **`null` means "do not gate."** It covers both "no adult-class question exists
 * for this family" and "a read failed". Both resolve the same way on purpose:
 * this gate REDIRECTS and runs on every `/family/*` render, so a transient
 * Firestore error must cost the family an un-asked question, never a 500 across
 * the whole portal. `getLegacyPaymentStatus` already fails soft the same way
 * (`legacy-payment.ts:71-74`), as do load-dashboard's cosmetic reads.
 *
 * Precisely: **every Firestore/RTDB read fails soft** - not "this function never
 * throws". The two in-memory exits below run OUTSIDE the try deliberately. They
 * only walk an already-loaded `members` array, so the sole way they can throw is
 * a caller passing something that is not a well-formed `MemberDoc[]` - a
 * programming error that should fail loudly in dev, not be laundered into
 * "nothing to ask this family".
 *
 * **A consumer that RENDERS rather than gates must not reuse this `null` as its
 * own truth.** If `/adult-class` treated null as "nothing to select" and
 * redirected back to `/family`, an intermittent read failure would ping-pong the
 * two routes - the `ERR_TOO_MANY_REDIRECTS` shape this codebase has hit before.
 * That screen needs its own error state.
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
export async function loadAdultClassGateData(
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

  try {
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
      // One teacherAssignments doc read per CANDIDATE - never per member. A
      // child is not a teacher-assignable person and a pending invitee cannot be
      // chosen, so neither is worth a read. Concurrent, so this is one round
      // trip rather than N.
      (async (): Promise<ReadonlySet<string>> => {
        const flags = await Promise.all(candidates.map((m) => isTeacherAssigned(m.mid)));
        return new Set(candidates.filter((_, i) => flags[i]).map((m) => m.mid));
      })(),
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
  } catch (err) {
    console.error('[adult-class] gate data load failed - not gating this render', err);
    return null;
  }
}
