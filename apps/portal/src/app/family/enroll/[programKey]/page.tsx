import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { EnrollCta } from '@/features/family/components/enroll-cta';
import { EnrollPanel } from '@/features/family/components/enroll-panel';
import { EligibleMembersList } from '@/features/family/components/eligible-members-list';
import { CompleteDonationButton } from '@/features/family/components/complete-donation-button';
import { resolveSuggestedAmount, paymentSourceOf, memberEligibleForProgram, gradeLabel, BALA_VIHAR } from '@cmt/shared-domain';
import { isAdultStudyClassKey } from '@/features/setu/adult-class/program-keys';
import type { OfferingDoc, PaymentSource } from '@cmt/shared-domain';
import { isPledgeGiving, isParticipating } from '@cmt/shared-domain/setu';
import { flags } from '@/lib/flags';
import { getFamilyPledge } from '@/features/setu/pledges/get-family-pledge';
import { clearAbandonedPledge } from '@/features/setu/pledges/clear-abandoned-pledge';
import { configuredMonthlyAmountCAD } from '@/features/setu/pledges/pledge-amount';
import { MonthlyDonationOption } from '@/features/setu/pledges/components/monthly-donation-option';
import { DonationChoice, type PledgeState } from '@/features/setu/pledges/components/donation-choice';
import { getProgram } from '@/features/setu/programs/get-programs';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getOpenOfferingsForFamily, resolveCurrentOffering } from '@/features/setu/enrollment/get-open-offerings';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getDonations } from '@/features/setu/donations/get-donations';

export const metadata = { title: 'Enroll' };

interface Props {
  params: Promise<{ programKey: string }>;
}

function fmtDate(d: Date | null) {
  if (!d) return '—';
  return d.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
}

function offeringPaymentSource(offering: Pick<OfferingDoc, 'paymentSource'> | null | undefined): PaymentSource {
  return paymentSourceOf(offering?.paymentSource !== undefined ? { paymentSource: offering.paymentSource } : {});
}

function canCollectOnline(usesDonation: boolean, donationsEnabled: boolean, paymentSource: PaymentSource) {
  return usesDonation && donationsEnabled && paymentSource !== 'teacher-managed';
}

function enrolledStateText(usesDonation: boolean, paymentSource: PaymentSource) {
  if (usesDonation && paymentSource === 'teacher-managed') {
    return 'Your family is enrolled — payment is managed by the teacher.';
  }
  return usesDonation ? 'Your family is enrolled — donation coming soon.' : 'Your family is enrolled.';
}

function renderAlreadyEnrolledBanner(
  termLabel: string,
  paid = false,
  usesDonation = false,
  paymentSource: PaymentSource = 'portal',
  nothingToPay = false,
  nothingToPayReason: NothingToPayReason = 'free',
) {
  // "Proceed to donate below." only makes sense when the program actually takes
  // a donation; a free program (usesDonation=false) just confirms enrollment,
  // and a WAIVED one (nothingToPay) has a donation in principle but none owed -
  // sending that family to "donate below" pointed at a $0 ask that could never
  // be completed.
  const message = paid
    ? `Your family is enrolled in ${termLabel} and your contribution is paid. Thank you.`
    : nothingToPay
      ? nothingToPayReason === 'settled-off-portal'
        // A bare "There is nothing to pay" reads, to a family who pays CMT every
        // month by direct debit, as though their arrangement had been forgotten.
        ? `Your family is enrolled in ${termLabel}. Your donation is already arranged with Chinmaya Mission.`
        : `Your family is enrolled in ${termLabel}. There is nothing to pay.`
    : usesDonation && paymentSource === 'teacher-managed'
      ? `Your family is already enrolled in ${termLabel}. Payment is managed by the teacher.`
    : usesDonation
      ? `Your family is already enrolled in ${termLabel}. Proceed to donate below.`
      : `Your family is already enrolled in ${termLabel}.`;
  return (
    <div style={{ padding: '14px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
      {message}
    </div>
  );
}

function renderNoPeriodBanner(programLabel: string, location: string | null) {
  return (
    <div style={{ padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, color: 'var(--body-text)' }}>
      No open enrollment for <strong>{programLabel}</strong>{location ? ` at ${location}` : ''} right now — check back soon.
    </div>
  );
}

function renderPaidPanel(termLabel: string) {
  return (
    <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
        Donation
      </h3>
      <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
        Paid · {termLabel}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: '14px 0 0' }}>
        Your {termLabel} contribution is recorded as paid — thank you. No further action needed.
      </p>
    </div>
  );
}

function renderPaidBlockMobile(termLabel: string) {
  return (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      <span className="pill" style={{ background: 'var(--surface)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
        Paid · {termLabel}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 12, lineHeight: 1.5 }}>
        Your {termLabel} contribution is recorded as paid — thank you. No further action needed.
      </p>
    </div>
  );
}

/**
 * WHY this family is not being asked for money. Three different facts that all
 * used to arrive as one `waived` boolean, because all three are stored as a
 * suggested amount of zero.
 *
 * `settled-off-portal` is the one that was being mis-told: an admin has
 * recorded that CMT collects this family's donation outside the portal (a
 * long-standing pre-authorized debit), and the family was shown "Your Bala
 * Vihar donation covers this class" - on the Bala Vihar enrollment itself.
 */
type NothingToPayReason = 'settled-off-portal' | 'waived-by-bala-vihar' | 'free';

/**
 * The enrollment costs nothing - so say that, rather than asking for $0.
 *
 * ── Why this is its own state and not `paid` ────────────────────────────────
 * A family who has paid Bala Vihar attends the Adult Study Class at no further
 * cost (spec 4.5), which `enrollFamily` records as `suggestedAmountOverride: 0`.
 * That is NOT the same as having paid this enrollment, so it must not borrow the
 * "Paid · thank you" copy - the family gave nothing here and telling them
 * otherwise is simply false.
 *
 * ── The dead end this replaces ──────────────────────────────────────────────
 * Reported 2026-07-28: the adult-class page showed "$0 · per family" under
 * "Proceed to donate below", with a live "Continue to donation" button. It could
 * never resolve: `donationComplete` requires `displaySuggestedAmount > 0`, so a
 * waived enrollment is never `paid` and the ask renders forever. Clicking it
 * looped - `CompleteDonationButton` bails to `/family/donate` below $1, and the
 * checkout API rejects anything under $1 too.
 */
function renderNothingToPay(reason: NothingToPayReason, opts: { desktop: boolean }) {
  const body =
    reason === 'settled-off-portal'
      ? 'Your donation is already arranged with Chinmaya Mission — there is nothing to pay here.'
      : reason === 'waived-by-bala-vihar'
        ? 'Your Bala Vihar donation covers this class — there is nothing to pay here.'
        : 'There is no donation for this program — you are all set.';
  const inner = (
    <>
      <span
        className="pill"
        style={{ background: opts.desktop ? 'var(--accentSoft)' : 'var(--surface)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}
      >
        {reason === 'settled-off-portal' ? 'Recorded' : 'Included'}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 12, lineHeight: 1.55 }}>{body}</p>
    </>
  );

  return opts.desktop ? (
    <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
        Donation
      </h3>
      {inner}
    </div>
  ) : (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      {inner}
    </div>
  );
}

function renderDonationBlock(suggestedAmount: number) {
  // Suggested donation only — no "rate", no "not required / any amount welcome"
  // copy (owner 2026-07-10). The section label above already reads
  // "Donation · suggested donation".
  return (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 40 }}>${suggestedAmount}</span>
        <span style={{ fontSize: 13, color: 'var(--body-text)' }}>per family · suggested</span>
      </div>
    </div>
  );
}

export default async function ProgramEnrollPage({ params }: Props) {
  await connection();

  const { programKey } = await params;

  // Load program + family in parallel.
  const [program, familyData] = await Promise.all([
    getProgram(programKey),
    getCurrentFamily(),
  ]);

  if (!program || program.status !== 'active') notFound();

  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const { family, members, isManager } = familyData;
  const isBv = programKey === BALA_VIHAR;

  // Filter eligible members per program eligibility.
  const now = new Date();
  const eligibleMembers = members.filter((m) =>
    memberEligibleForProgram(m, program.eligibility, now),
  );

  // For BV (child-only): show the children list. For generic: show eligible members.
  //
  // Retired members are excluded from BOTH, and that is not cosmetic. `enrollFamily`
  // filters them server-side, so a page that still counted them would show the
  // enrol CTA, then answer "Add a child to your family before enrolling" to a
  // family looking at the child it just listed. That dead end lands hardest on
  // exactly the families the 2026-08-03 lazy-migration change touches: their
  // only child may have been auto-retired because the legacy roster had no
  // class level for them.
  const participating = members.filter((m) => isParticipating(m));
  const eligibleForDisplay = isBv
    ? participating.filter((m) => m.type === 'Child')
    : eligibleMembers.filter((m) => isParticipating(m));

  const [enrollments, openOfferings, donations] = await Promise.all([
    getEnrollments(family.fid),
    getOpenOfferingsForFamily(programKey, family.location),
    getDonations(family.fid),
  ]);

  // Auto-select the family's offering. NOT `openOfferings[0]`: that array merges
  // this centre's offerings with the location-less (online) ones, so `[0]` means
  // "earliest" and silently defaults a located family to an online class that
  // happens to start first. It also has to agree with the adult-class gate,
  // which fires on one specific oid and sends the family to /adult-class to
  // enroll in it - two different answers would ask them to choose, then default
  // this page to a different class.
  const defaultOffering = resolveCurrentOffering(openOfferings, family.location);

  // Find the active enrollment for THIS program that matches an open offering.
  // A stale enrollment from a prior term (oid not in openOfferings) must not
  // block the enroll/no-period states — identical to the old BV page guard.
  const openOidSet = new Set(openOfferings.map((o) => o.oid));
  const activeEnrollment =
    enrollments.find(
      (e) => e.status === 'active' && e.programKey === programKey && openOidSet.has(e.oid),
    ) ?? null;

  // For already-enrolled: find the matching open offering (so the CTA is correct).
  const enrolledOffering = activeEnrollment
    ? openOfferings.find((o) => o.oid === activeEnrollment.oid) ?? defaultOffering
    : defaultOffering;

  const alreadyEnrolled = activeEnrollment !== null;

  // ── Who this list is ABOUT changes once the family has enrolled ────────────
  //
  // Before enrolling it is a preview: "these are the people who will be
  // enrolled", every row ticked, which is honest because enrollFamily does
  // exactly that when no explicit selection is supplied.
  //
  // AFTER enrolling it must be a record, and it was not. Reported 2026-07-28:
  // a family who enrolled ONE adult in the Adult Study Class saw all three
  // ticked. Verified against UAT that the DATA was right - `enrolledMids` held
  // exactly one - so the page was simply reporting eligibility while wearing a
  // hardcoded checkmark. Nobody was over-enrolled; the screen just said so.
  //
  // `enrolledMids` was already on EnrollmentDoc and simply never read here.
  // Falls back to the eligible list when it is empty, so a legacy or
  // mid-less enrollment still shows something rather than an empty card.
  const enrolledMidSet = new Set(activeEnrollment?.enrolledMids ?? []);
  const displayMembers =
    alreadyEnrolled && enrolledMidSet.size > 0
      ? members.filter((m) => enrolledMidSet.has(m.mid))
      : eligibleForDisplay;
  const donationsEnabled = process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS === 'true';
  const usesDonation = program.capabilities.usesDonation;
  const selectedPaymentSource = offeringPaymentSource(enrolledOffering);
  const onlineDonationsEnabled = canCollectOnline(usesDonation, donationsEnabled, selectedPaymentSource);

  // Legacy payment gate — BALA VIHAR ONLY. getLegacyPaymentStatus reads the BV
  // roster's `payment` column (the 2025-26 cutover), which has no program
  // dimension. Applying it to another program (even one whose offering is mis-set
  // to paymentSource:'legacy') would show BV's payment status for a non-BV
  // donation, so gate the whole bridge on programKey.
  const isLegacyPeriod =
    programKey === 'bala-vihar' &&
    enrolledOffering != null &&
    selectedPaymentSource === 'legacy';
  const legacyPaid =
    isLegacyPeriod && (await getLegacyPaymentStatus(family.legacyFid)) === 'paid';

  const activeTerm = activeEnrollment?.termLabel ?? enrolledOffering?.termLabel ?? '';
  const displaySuggestedAmount =
    activeEnrollment?.effectiveSuggestedAmount ??
    (enrolledOffering ? resolveSuggestedAmount(enrolledOffering, now) : undefined);

  // "Paid" = legacy-roster paid OR completed Setu donation(s) for THIS enrollment
  // covering the suggested amount. Once paid, the page shows a thank-you panel and
  // no donate CTA — giving more lives in the Giving tab.
  const givenForPeriod = activeEnrollment
    ? donations
        .filter((d) => d.status === 'completed' && d.eid === activeEnrollment.eid)
        .reduce((sum, d) => sum + d.amountCAD, 0)
    : 0;
  const donationComplete =
    displaySuggestedAmount != null && displaySuggestedAmount > 0 && givenForPeriod >= displaySuggestedAmount;
  const paid = legacyPaid || donationComplete;

  // ── Enrolled, and there is genuinely nothing to pay ────────────────────────
  //
  // A zero suggested amount is not a $0 ask - it means no donation is owed. Most
  // often that is the Adult Study Class fee waiver for a family who has paid Bala
  // Vihar (`suggestedAmountOverride: 0`), and `waivedByBv` distinguishes that
  // from a program that is simply free, so the copy can be specific rather than
  // vague. Deliberately separate from `paid`: they have not paid this
  // enrollment, and "Paid · thank you" would be untrue.
  const nothingToPay =
    !paid && alreadyEnrolled && usesDonation && displaySuggestedAmount === 0;
  // Settlement is checked FIRST because it is stored as the same zero override
  // the waiver uses - the flag is the only thing that tells them apart.
  //
  // And the waiver is scoped to the ADULT STUDY CLASS, for the same reason the
  // admin control is (see payment-override-control.tsx). The Bala-Vihar-paid
  // waiver has TWO writers - `api/setu/adult-class/route.ts` and the generic
  // `api/setu/enrollments/route.ts` via `resolveAdultClassEnrollParams`
  // (enroll-params.ts:90) - and both are gated on `isAdultStudyClassKey`, so a
  // bare unexplained zero never lands on an adult-class enrollment. Check that
  // gate before adding a third. Unscoped, this branch told a family whose
  // Bala Vihar was settled off-portal before the flag existed that "Your Bala
  // Vihar donation covers this class" - about their Bala Vihar enrollment. That
  // is live for CMT-SXO5QWFI until an admin re-records the settlement, and it
  // is the family-facing half of a bug I fixed on the staff side first.
  //
  // A bare zero on any other program falls through to 'free', which says
  // "There is no donation for this program - you are all set." That is true as
  // far as the family is concerned (they are not being asked for anything) and
  // makes no claim about WHY, which is the part we cannot know here.
  //
  // `isAdultStudyClassKey`, never `programKey === ADULT_STUDY_CLASS`. The
  // literal only ever matches Brampton's class: each centre may run its own
  // program (Scarborough's is `adult-study-east`), so a bare comparison told
  // every Scarborough family "there is no donation for this program" when the
  // truth was "your Bala Vihar donation covers it". Same one-day bug as the
  // staff control - see PaymentOverrideEnrollment.isAdultClass.
  const isAdultClass = await isAdultStudyClassKey(programKey);
  const nothingToPayReason: NothingToPayReason =
    activeEnrollment?.settledOffPortal === true
      ? 'settled-off-portal'
      : activeEnrollment?.suggestedAmountOverride === 0 && isAdultClass
        ? 'waived-by-bala-vihar'
        : 'free';

  // The OID to use for the EnrollCta — prefer the enrolled offering when already enrolled.
  const ctaOid = enrolledOffering?.oid ?? defaultOffering?.oid ?? '';

  // A Bala Vihar family with zero children cannot enroll (enrollFamily would throw
  // 'no-eligible-members'). Managers get "add a child" guidance instead of the CTA;
  // non-managers still see the manager message (handled below by precedence).
  const bvNoChildren = isBv && displayMembers.length === 0;

  // ── The monthly alternative, BESIDE the one-time ask ────────────────────────
  // Vaibhav 2026-07-27: the monthly plan is not a separate appeal - it is the
  // SECOND way to pay the Bala Vihar contribution. "$500 once, or $51 a month."
  //
  // It first shipped only on /family/donate, which turned out to be a page this
  // flow never visits: EnrollCta sends the family STRAIGHT to Stripe at the full
  // amount (owner decision 2026-07-04, predating the pledge work), and the
  // dashboard's "Complete donation" does the same. So the choice existed but was
  // unreachable - a family enrolling only ever saw $500. It has to be offered
  // where the decision is actually made, which is this page.
  //
  // `onlineDonationsEnabled` already means usesDonation && donationsEnabled &&
  // paymentSource !== 'teacher-managed', which is exactly the donate page's gate.
  // `!paid` because a family who has already paid has nothing left to spread.
  const pledgeEligible = flags.setuPledge && isBv && onlineDonationsEnabled && !paid;

  // ── An unfinished pledge must not lock this page ───────────────────────────
  //
  // Vaibhav, 2026-07-29: *"If someone selects the Pledge option, and not
  // complete, then the process is not complete and they need to be taken back to
  // options again where they can select donation or pledge... It's for family to
  // start the donation process again and complete on their own since this is
  // complete self serve."*
  //
  // He is describing this page. A hosted session the family backed out of
  // answers `pending` forever, so the pledge stayed `started` and this page
  // rendered "we're setting up your monthly gift - nothing more for you to do",
  // which was simply untrue: nothing was being set up and nobody was going to
  // fix it.
  //
  // Resolved BEFORE the pledge is read, so the read below sees the true state
  // and the family gets the ordinary choice back with no special-case branch
  // anywhere downstream. `clearAbandonedPledge` asks Stripe first and fails
  // CLOSED - it only clears what Stripe says was never submitted.
  let existingPledge = pledgeEligible ? await getFamilyPledge(family.fid) : null;
  // Only a `started` pledge can be an unfinished attempt, and only then is the
  // provider round trip worth paying for - see the dashboard for why gating on
  // the read matters rather than clearing unconditionally.
  if (existingPledge?.status === 'started') {
    if ((await clearAbandonedPledge(family.fid)) === 'cleared') {
      existingPledge = await getFamilyPledge(family.fid);
    }
  }

  // ── 🔴 The bare card is for ENROLLED families only ──────────────────────────
  //
  // `MonthlyDonationOption`'s button starts a mandate and does NOT enrol.
  // Rendering it to a family who has not joined produced exactly what you would
  // expect and what Vaibhav photographed on 2026-07-28: a Bala Vihar page
  // reading "Add a child to enroll" directly above "Give $51 monthly", and a
  // UAT family with ZERO children holding a live `started` pledge.
  //
  // `DonationChoice` owns every not-yet-enrolled case because it enrols FIRST
  // and pays second. Where the choice cannot render - no children, not the
  // manager, several open terms - the honest answer is no monthly ask at all.
  // `/family/donate` has always had this gate (it requires an enrollment eid);
  // this page simply never applied it. The server refuses too, in the route.
  const monthlyOption = pledgeEligible && alreadyEnrolled ? (
    <MonthlyDonationOption
      monthlyAmountCAD={configuredMonthlyAmountCAD()}
      oneTimeAmountCAD={displaySuggestedAmount ?? null}
      canStart={isManager}
      alreadyPledging={isPledgeGiving(existingPledge)}
    />
  ) : null;

  // ── "Choose your donation" - the unified radio group (Vaibhav, 2026-07-28) ──
  //
  // It replaces the suggested-amount block, the one-time CTA and the separate
  // monthly card with ONE decision carrying ONE call to action. Two primary
  // buttons for a single choice is the ambiguity that made the pledge invisible
  // in the first place.
  //
  // Scoped to the ALREADY-ENROLLED state, which is the only one the design
  // covers and the only one with an `eid` to pin a checkout to. A family who has
  // not enrolled yet still clicks Enroll (which goes straight to Stripe at the
  // full amount), so `monthlyOption` is deliberately KEPT for that state - drop
  // it and the monthly plan becomes unreachable again for exactly the families
  // who have not yet paid anything.
  const pledgeState: PledgeState = isPledgeGiving(existingPledge)
    ? 'giving'
    : existingPledge?.status === 'started'
      ? 'pending'
      : 'none';
  // Captured into a local rather than tested as a boolean, so TypeScript narrows
  // `activeEnrollment` for the two reads below instead of trusting a flag.
  const choiceEnrollment =
    pledgeEligible && alreadyEnrolled && onlineDonationsEnabled ? activeEnrollment : null;

  // ── The NOT-yet-enrolled case ──────────────────────────────────────────────
  //
  // Originally the choice was scoped to already-enrolled families, on the
  // grounds that it is the only state the design draws and the only one with an
  // `eid`. That was wrong in practice: a family joining for the FIRST time is
  // exactly who is deciding how to pay, and they were still met by the old pair
  // of buttons ("Enroll →" plus a separate "Give $51 monthly"). DonationChoice
  // now enrols them itself when handed an `enrollOid`, so both states get one
  // decision. Requires a manager and a single open offering - the multi-offering
  // path (`showInlinePanel`) owns its own term picker and submit.
  const choiceEnrollOid =
    pledgeEligible && !alreadyEnrolled && isManager && !bvNoChildren && openOfferings.length <= 1
      ? ctaOid
      : null;

  const donationChoice =
    choiceEnrollment || choiceEnrollOid ? (
      <DonationChoice
        eid={choiceEnrollment?.eid ?? null}
        enrollOid={choiceEnrollOid}
        oneTimeAmountCAD={choiceEnrollment?.effectiveSuggestedAmount ?? displaySuggestedAmount ?? 0}
        monthlyAmountCAD={configuredMonthlyAmountCAD()}
        canStartPledge={isManager}
        pledgeState={pledgeState}
      />
    ) : null;

  // When MULTIPLE offerings are open and the manager can still enroll, the term
  // picker and submit must share client state — render them together via
  // EnrollPanel. Single-offering (BV) keeps the bare CTA path unchanged.
  const showInlinePanel =
    !alreadyEnrolled && isManager && Boolean(ctaOid) && openOfferings.length > 1;

  return (
    <>
      {/* ── Mobile ───────────────────────────────────────────────── */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" prefetch={false} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Enroll</span>
              <span style={{ width: 32 }} />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 100px' }}>
              {alreadyEnrolled && renderAlreadyEnrolledBanner(activeTerm, paid, usesDonation, selectedPaymentSource, nothingToPay, nothingToPayReason)}
              {!enrolledOffering && !alreadyEnrolled && renderNoPeriodBanner(program.label, family.location)}

              {enrolledOffering && (
                <>
                  {/* Program hero banner */}
                  <div style={{ padding: '18px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', right: -20, top: -20, opacity: .2 }}>
                      <Rosette size={120} color="#fff" stroke={.8} />
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', opacity: .85, marginBottom: 6 }}>Enroll in</div>
                      <h1 style={{ fontSize: 26, fontWeight: 500, color: '#fff', fontFamily: 'var(--display)' }}>
                        {isBv ? <em className="sa">Bala Vihar</em> : program.label} · {enrolledOffering.termLabel}
                      </h1>
                      <p style={{ fontSize: 13, opacity: .9, marginTop: 8 }}>
                        {fmtDate(enrolledOffering.startDate)} – {fmtDate(enrolledOffering.endDate)}{family.location ? ` · ${family.location}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Eligible members */}
                  {displayMembers.length > 0 && (
                    <>
                      <SectionLabel>{alreadyEnrolled ? 'Who’s enrolled' : 'Who’s enrolling'}</SectionLabel>
                      <EligibleMembersList
                        members={displayMembers}
                        eligibility={program.eligibility}
                        now={now}
                      />
                    </>
                  )}

                  {/* Donation — only when program uses donation.
                      `donationChoice` supersedes this block entirely: it states
                      both amounts itself, so rendering the suggested-amount card
                      above it would show "$500" twice with different meanings. */}
                  {usesDonation && !donationChoice && (
                    <>
                      <SectionLabel>Donation{paid || nothingToPay ? '' : ' · suggested donation'}</SectionLabel>
                      {paid
                        ? renderPaidBlockMobile(activeTerm)
                        : nothingToPay
                          ? renderNothingToPay(nothingToPayReason, { desktop: false })
                          : renderDonationBlock(displaySuggestedAmount ?? 0)}
                    </>
                  )}

                  {/* Multi-offering: term picker + submit live together (selection drives the oid).
                      Single-offering keeps the bare CTA in the sticky footer below (BV unchanged). */}
                  {showInlinePanel && (
                    <>
                      <SectionLabel>Select term</SectionLabel>
                      <EnrollPanel
                        offerings={openOfferings}
                        defaultOid={ctaOid}
                        donationsEnabled={usesDonation && donationsEnabled}
                        usesDonation={usesDonation}
                      />
                    </>
                  )}
                </>
              )}

              {/* The choice, inline in the scrollable content and carrying its
                  own CTA — as drawn in the mobile design. When it renders, the
                  sticky footer below stands down: two "Continue to donation"
                  buttons on one phone screen is worse than none. */}
              {donationChoice ?? monthlyOption}
            </div>

            {/* Sticky CTA footer. Suppressed when the inline choice owns the
                action, so the primary CTA appears exactly once. */}
            {!donationChoice && (
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              {alreadyEnrolled ? (
                // `nothingToPay` joins `paid` here: there is no donation to
                // collect, so the only honest control is the way out. Offering
                // "Continue to donation" for $0 led nowhere - both the button and
                // the checkout API reject anything under $1.
                paid || nothingToPay ? (
                  <Link href="/family" prefetch={false} className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                    Back to dashboard
                  </Link>
                ) : onlineDonationsEnabled ? (
                  <CompleteDonationButton eid={activeEnrollment.eid} amountCAD={activeEnrollment.effectiveSuggestedAmount} label="Continue to donation →" block />
                ) : (
                  <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                    {enrolledStateText(usesDonation, selectedPaymentSource)}
                  </div>
                )
              ) : showInlinePanel ? (
                <Link href="/family" prefetch={false} className="btn btn--s btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                  Cancel
                </Link>
              ) : ctaOid && isManager ? (
                bvNoChildren ? (
                  <Link href="/family/members/new" className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                    Add a child to enroll
                  </Link>
                ) : (
                  <EnrollCta oid={ctaOid} donationsEnabled={onlineDonationsEnabled} usesDonation={usesDonation} paymentSource={selectedPaymentSource} />
                )
              ) : ctaOid ? (
                <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                  Only the family manager can enroll
                </button>
              ) : (
                <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                  No active enrollment period
                </button>
              )}
            </div>
            )}
          </div>
        </CspRoot>
      </div>

      {/* ── Desktop ──────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 26 }}>
          <Link href="/family" prefetch={false} className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back /> Back to dashboard
          </Link>
          <div className="between">
            <div>
              <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Program enrollment</p>
              <h1 style={{ fontSize: 40, fontWeight: 400, marginTop: 6 }}>
                {isBv ? <em style={{ fontStyle: 'italic' }}>Bala Vihar</em> : program.label}
                {enrolledOffering ? ` · ${enrolledOffering.termLabel}` : ''}
              </h1>
            </div>
            {family.location && (
              <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
                {family.location}
              </span>
            )}
          </div>
        </header>

        {alreadyEnrolled && renderAlreadyEnrolledBanner(activeTerm, paid, usesDonation, selectedPaymentSource, nothingToPay, nothingToPayReason)}
        {!enrolledOffering && !alreadyEnrolled && renderNoPeriodBanner(program.label, family.location)}

        {enrolledOffering && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
            {/* Left: members + what's included */}
            <div>
              {displayMembers.length > 0 && (
                <div className="card" style={{ padding: 24, marginBottom: 14 }}>
                  <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>
                    {/* A record once enrolled, a preview before - the tick means
                        "will be enrolled" in one case and "is enrolled" in the
                        other, so the heading has to say which. */}
                    {isBv
                      ? alreadyEnrolled ? 'Children enrolled' : 'Children enrolling'
                      : alreadyEnrolled ? 'Members enrolled' : 'Members enrolling'}
                  </h3>
                  <div className="col" style={{ gap: 10 }}>
                    {displayMembers.map((m) => (
                      <div key={m.mid} style={{ padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                          <SetuIcon.check color="#fff" />
                        </div>
                        <SetuAvatar name={`${m.firstName} ${m.lastName}`} size={44} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{m.firstName} {m.lastName}</div>
                          {m.schoolGrade && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{gradeLabel(m.schoolGrade)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>What&apos;s included</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  {([
                    [isBv ? 'Sunday classes' : 'Program sessions',
                      `${fmtDate(enrolledOffering.startDate)}${enrolledOffering.endDate ? ` – ${fmtDate(enrolledOffering.endDate)}` : ' · ongoing'}`],
                  ] as [string, string][]).map(([t, sub], i) => (
                    <div key={i} className="row" style={{ gap: 12, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)' }}>
                      <div style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: '50%', background: 'var(--accentSoft)', color: 'var(--accentDeep)', display: 'grid', placeItems: 'center' }}>
                        <SetuIcon.check />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{t}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: offering picker + donation/confirm panel */}
            <aside>
              {paid ? renderPaidPanel(activeTerm) : nothingToPay ? (
                <div style={{ position: 'sticky', top: 0 }}>
                  {renderNothingToPay(nothingToPayReason, { desktop: true })}
                  <Link
                    href="/family"
                    prefetch={false}
                    className="btn btn--p btn--block"
                    style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 14 }}
                  >
                    Back to dashboard
                  </Link>
                </div>
              ) : donationChoice ? (
                // Brings its own card, heading, both amounts, the tax-deductible
                // line and the single CTA - so it stands in for the whole panel
                // rather than sitting inside it.
                <div style={{ position: 'sticky', top: 0 }}>{donationChoice}</div>
              ) : (
                <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
                  {/* Donation block — only for programs with usesDonation */}
                  {usesDonation ? (
                    <>
                      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
                        Donation · suggested donation
                      </h3>
                      <div style={{ padding: 18, background: 'var(--accentSoft)', borderRadius: 'var(--radiusSm)', marginBottom: 18 }}>
                        <div className="row" style={{ alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontFamily: 'var(--display)', fontSize: 46, lineHeight: 1 }}>${displaySuggestedAmount ?? 0}</span>
                          <span style={{ fontSize: 13, color: 'var(--body-text)' }}>· per family</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
                        Enrollment
                      </h3>
                      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, marginBottom: 18 }}>
                        This program has no donation requirement. Confirm enrollment below.
                      </p>
                    </>
                  )}

                  {alreadyEnrolled ? (
                    onlineDonationsEnabled ? (
                      <CompleteDonationButton eid={activeEnrollment.eid} amountCAD={activeEnrollment.effectiveSuggestedAmount} label="Continue to donation →" block />
                    ) : (
                      <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                        {enrolledStateText(usesDonation, selectedPaymentSource)}
                      </div>
                    )
                  ) : showInlinePanel ? (
                    <EnrollPanel
                      offerings={openOfferings}
                      defaultOid={ctaOid}
                      donationsEnabled={usesDonation && donationsEnabled}
                      usesDonation={usesDonation}
                      pickerLabel={
                        <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 10 }}>
                          Select term
                        </h3>
                      }
                    />
                  ) : isManager ? (
                    bvNoChildren ? (
                      <Link href="/family/members/new" className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                        Add a child to enroll
                      </Link>
                    ) : (
                      <EnrollCta oid={ctaOid} donationsEnabled={onlineDonationsEnabled} usesDonation={usesDonation} paymentSource={selectedPaymentSource} />
                    )
                  ) : (
                    <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                      Only the family manager can enroll
                    </button>
                  )}

                  {usesDonation && (
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
                      Donations are tax-deductible · Chinmaya Mission Toronto
                    </p>
                  )}

                  {/* The second way to pay, directly under the one-time CTA so
                      both answers are visible before the family commits. */}
                  {monthlyOption}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
