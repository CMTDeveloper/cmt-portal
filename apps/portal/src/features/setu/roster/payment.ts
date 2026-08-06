import 'server-only';
import { getEnrollments, type EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import {
  classifyRosterPayment,
  explainRosterPayment,
  type ActiveEnrollmentCharge,
  type RosterPaymentUnknownReason,
} from '@cmt/shared-domain/setu';
import type { OfferingDoc, RosterPayment } from '@cmt/shared-domain/setu';
import type { DonationDoc } from '@cmt/shared-domain';
import { sumCompleted } from './donations-sum';
import { getDonations } from '@/features/setu/donations/get-donations';
import { selectFamilyPledge } from '@/features/setu/pledges/select-family-pledge';
import { getPledgesForStaff, type StaffPledgeView } from '@/features/setu/pledges/get-pledges-for-staff';
import { flags } from '@/lib/flags';

/**
 * The one adapter from a joined enrollment to a payment charge.
 *
 * Deliberately NOT `e.effectiveSuggestedAmount`: that field collapses a missing
 * offering onto the enroll-time snapshot, so an enrollment nobody ever priced
 * arrives here as a confident `0` and would be reported as owing nothing.
 * `chargeAmount` needs the raw pieces to tell those apart.
 */
export function chargeFromEnrollment(e: EnrollmentWithOffering): ActiveEnrollmentCharge {
  return {
    override: e.suggestedAmountOverride ?? null,
    snapshot: e.suggestedAmountSnapshot,
    offering: e.offering,
    enrolledAt: e.enrolledAt,
    // `=== true`, not a truthiness check: the field is absent on every
    // enrollment written before 2026-08-04, and absent must read as "not
    // settled" rather than as `undefined` leaking into a boolean position.
    settledOffPortal: e.settledOffPortal === true,
  };
}

/** One active enrollment as the two bulk roster passes hold it. */
export interface BulkActiveEnrollment {
  oid: string;
  override: number | null;
  snapshot: number;
  enrolledAt: Date;
  /** See `ActiveEnrollmentCharge.settledOffPortal` - required for the same reason. */
  settledOffPortal: boolean;
}

/**
 * The same verdict for the bulk passes, which hold offerings in a map keyed by
 * oid rather than joined onto each enrollment. Exists so neither of them
 * re-derives the override → offering → snapshot fallback by hand; that chain
 * lives in `chargeAmount` and nowhere else.
 */
export function classifyBulkPayment(
  active: readonly BulkActiveEnrollment[],
  offerings: ReadonlyMap<string, Pick<OfferingDoc, 'pricingTiers' | 'paymentSource'>>,
  paidCAD: number,
): RosterPayment {
  return classifyRosterPayment(
    active.map((a) => ({
      override: a.override,
      snapshot: a.snapshot,
      offering: offerings.get(a.oid) ?? null,
      enrolledAt: a.enrolledAt,
      settledOffPortal: a.settledOffPortal,
    })),
    paidCAD,
  );
}

/**
 * Best-effort payment status for a family. NEVER throws — a derivation failure
 * for one family must not break the roster page (returns 'unknown').
 * Classifies ALL active enrollments (N=2 safe), not the first.
 *
 * ── A LIVE MONTHLY PLEDGE COUNTS AS PAID ────────────────────────────────────
 * Since 2026-07-27 the monthly pledge IS the Bala Vihar enrollment donation,
 * and a live plan writes NO completed donation docs - there is no Stripe
 * webhook (task #64/#54), so `sumCompletedDonations` returns 0 for a family
 * paying every month. Classified on donations alone they read 'outstanding'
 * forever.
 *
 * Every other paid-verdict surface already knows this and ORs the pledge in:
 * report-dataset.ts:197 (the welcome roster's Paid chip), build-csv-rows.ts,
 * teacher/roster-confirmation.ts, reports/enrollment-report.ts and the family's
 * own dashboard. This one did not, so the family-detail screen would have
 * called every pledge family unpaid while the roster called them Paid - which
 * is the exact "two screens disagree" report this was written to fix
 * (Vaibhav, FID 5010), reproduced for a different payment method. Caught in
 * review before it shipped.
 *
 * `getFamilyPledge` rather than `loadActivePledgeFids`: this is one family, and
 * the bulk set exists so the ~870-row roster does not fan out per family. The
 * two agree by construction - `selectFamilyPledge` ranks `active` above every
 * other status, so if ANY doc for the fid is active this returns it, which is
 * the same membership test the bulk set performs.
 *
 * `active` only, never `started`. NOT because `started` means nothing happened:
 * a pre-authorized debit "settles in days, not minutes" (reconcile-pledges.ts:9,
 * STALE_AFTER_DAYS = 14), so `started` routinely IS a real mandate the portal
 * has not observed yet. It means UNRESOLVED - possibly abandoned mid-flow,
 * possibly awaiting the daily reconcile - and unresolved is not paid. Counting
 * it would label a family who clicked once and left as Paid; refusing
 * settlement on it would strand an abandoned-pledge family for up to 14 days
 * when they arrange a genuine off-portal payment instead.
 */
export async function deriveFamilyPayment(fid: string): Promise<RosterPayment> {
  try {
    return (await loadFamilyPaymentData(fid)).verdict;
  } catch {
    // KEPT, and load-bearing. The off-portal override route calls this as its
    // money guard and its own comment records the contract: "deriveFamilyPayment
    // already swallows and returns 'unknown'" (override/route.ts:146). The
    // loader below deliberately THROWS on an enrollments failure so the page can
    // collapse its write panel closed; this catch is what keeps that new
    // behaviour from reaching the five callers who were promised a word.
    return 'unknown';
  }
}

/**
 * A family's payment picture: the verdict AND the evidence behind it, from ONE
 * set of reads.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `deriveFamilyPayment` used to read enrollments, donations and the pledge, then
 * throw all three away and return a single word. The welcome desk got that word
 * and nothing else - and because `explainRosterPayment` can reach `unknown` four
 * different ways, "Unknown" told a volunteer nothing they could repeat to a
 * family on the phone. They opened the Stripe dashboard instead (Vaibhav,
 * 2026-08-05). This returns what was already being read.
 *
 * ── What it costs, by viewer ────────────────────────────────────────────────
 * For an ADMIN it is strictly cheaper. The family-detail page ran
 * `getEnrollments(fid)` TWICE per render - once directly for the override
 * control, once inside `deriveFamilyPayment` - and `sumCompletedDonations`
 * re-queried donations the page then had no way to show. One loader means one
 * read per collection, so the admin view now shows far more for one fewer query.
 *
 * For a welcome-team volunteer or a coordinator it is NOT cheaper: that page
 * previously performed NO payment reads at all (the whole block was behind
 * `admin`), and now performs three. They are single-family, indexed, and issued
 * in one `Promise.all` beside the existing seva read, so they add no waterfall
 * depth - but "fewer reads" is an admin-only claim and saying it unqualified
 * would be false for most of the people who open this page.
 *
 * ── The three failure directions are NOT the same ───────────────────────────
 * They are chosen so that every failure lands on the safe side of a DIFFERENT
 * decision, which is why this is not a single try/catch:
 *
 *  1. Enrollments fail → THROW. The caller cannot render a payment panel without
 *     them, and the page's own comment explains why a soft empty list is worse
 *     than no panel: it would make every waived enrollment look like an
 *     unexplained zero and re-offer "Mark paid off-portal" on money already
 *     handled. Failing OPEN there writes a false money record.
 *  2. Donations fail → 'unavailable', and the verdict is forced to 'unknown'.
 *     Never classify with `paidCAD: 0` on a failed read: that reports a paid-up
 *     family as `outstanding`, which is a dunning letter to someone who already
 *     gave.
 *  3. Pledge fails → 'unavailable', verdict 'unknown' by the same argument (a
 *     live monthly pledge writes no completed donations, so a lost pledge read
 *     is indistinguishable from a family who never gave).
 *
 * `unknown` deliberately leaves the off-portal override AVAILABLE - the route
 * refuses only on a positive 'paid', because blocking settlement on absence of
 * evidence would strand the families that action exists for.
 */
/**
 * Why THIS screen cannot answer - the domain's four reasons, plus one only a
 * caller with a failed read can know about.
 *
 * `donations-unavailable` is deliberately a NAMED reason rather than `null`.
 * The first cut returned `unknown` with no reason on a failed donations read,
 * which put a bare "Unknown" chip in front of a volunteer with nothing to tell
 * the family - exactly the failure this whole feature exists to end,
 * reintroduced through the back door. Worse, it was type-INVISIBLE: nothing
 * would ever have forced copy to exist for it. Naming it makes the panel's
 * `Record<FamilyUnknownReason, string>` refuse to compile without a sentence.
 */
export type FamilyUnknownReason = RosterPaymentUnknownReason | 'donations-unavailable';

export interface FamilyPaymentData {
  /** ALL enrollments, active and cancelled, newest first. */
  enrollments: EnrollmentWithOffering[];
  /** Newest first, or 'unavailable' when the read failed. */
  donations: DonationDoc[] | 'unavailable';
  /**
   * Every pledge attempt, newest first. 'unavailable' on a failed read;
   * an EMPTY ARRAY when the feature flag is dark, which is a different fact and
   * must not be conflated - a dark flag is not a broken read.
   */
  pledges: StaffPledgeView[] | 'unavailable';
  verdict: RosterPayment;
  /** What the family owes across active enrollments; null when unknowable. */
  expectedCAD: number | null;
  /** Completed donations, ALL TIME (#117). Null when the read failed. */
  paidCAD: number | null;
  /** Why the verdict is `unknown`. Null on every other verdict. */
  unknownReason: FamilyUnknownReason | null;
  /** True when an active pledge is what makes this family 'paid'. */
  paidByPledge: boolean;
}

export async function loadFamilyPaymentData(fid: string): Promise<FamilyPaymentData> {
  // Enrollments are NOT caught here - see failure direction 1 above.
  const [enrollments, donations, pledges] = await Promise.all([
    getEnrollments(fid),
    getDonations(fid).catch(() => 'unavailable' as const),
    // Flag-gated to match `loadActivePledgeFids`, which returns an empty set
    // when the feature is dark. Without this, flipping the kill switch would
    // silence pledges on every roster and report while THIS predicate alone
    // kept answering 'paid' and refusing settlements - the "one answer across
    // surfaces" property holding right up until the moment it is most needed.
    flags.setuPledge
      ? getPledgesForStaff(fid).catch(() => 'unavailable' as const)
      : Promise.resolve([] as StaffPledgeView[]),
  ]);

  const active = enrollments.filter((e) => e.status === 'active');

  // ── Donations lost: the verdict is UNKNOWN ─────────────────────────────────
  // A lost read is not evidence of absence. Classifying with `paidCAD: 0` would
  // report a paid-up family as `outstanding` - a dunning letter to someone who
  // already gave. This matches the behaviour of the original try/catch, which
  // swallowed a donations failure into 'unknown'.
  if (donations === 'unavailable') {
    return {
      enrollments,
      donations,
      pledges,
      verdict: 'unknown',
      expectedCAD: null,
      paidCAD: null,
      unknownReason: 'donations-unavailable',
      paidByPledge: false,
    };
  }

  const paidCAD = sumCompleted(donations);

  // ── Pledges lost: fall through, do NOT force unknown ───────────────────────
  // The asymmetry with donations above is deliberate and pre-dates this loader:
  // a pinned test names it ("survives a failed pledge read rather than reporting
  // unknown for everyone"). The pledge read is one query behind a feature flag,
  // and a single outage would otherwise blank the payment column for EVERY
  // family on the roster at once. Falling back to the enrollment arithmetic
  // costs a pledge-paying family with no completed donations a false
  // 'outstanding' - bad, but bounded to the families it actually describes,
  // where the alternative is bad for all of them. The screen is told separately
  // (`pledges === 'unavailable'`) so it can say the pledge history is missing
  // rather than implying the family has none.
  //
  // `selectFamilyPledge` over the staff rows rather than a fresh
  // `.some(p => p.status === 'active')`: StaffPledgeView structurally extends
  // FamilyPledgeView precisely so the ranking rule stays defined in exactly one
  // place. The two agree by construction instead of by inspection.
  const ranked = pledges === 'unavailable' ? null : selectFamilyPledge(pledges);
  const paidByPledge = ranked?.status === 'active';

  // The pledge short-circuit is preserved verbatim from the original: a live
  // monthly plan writes no completed donation docs (there is no Stripe webhook),
  // so classifying such a family on donations alone reads 'outstanding' forever.
  const explained = explainRosterPayment(active.map(chargeFromEnrollment), paidCAD);

  return {
    enrollments,
    donations,
    pledges,
    verdict: paidByPledge ? 'paid' : explained.verdict,
    expectedCAD: explained.expectedCAD,
    paidCAD,
    // A pledge-paid family has no unresolved question, so no reason is offered
    // even when the enrollment arithmetic alone could not settle it.
    unknownReason: paidByPledge ? null : explained.unknownReason,
    paidByPledge,
  };
}
