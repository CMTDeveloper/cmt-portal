import { paymentSourceOf } from '@cmt/shared-domain';
import type { PaymentSource } from '@cmt/shared-domain';
import type { DonationDoc, ProgramDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { selectBalaViharEnrollment } from './select-bv-enrollment';
import { deriveProgramCards, type ProgramCard } from './derive-program-cards';
import { isEnrollmentConfirmed } from './enrollment-confirmation';

/**
/**
 * True when the active Bala Vihar enrollment's offering is legacy-sourced (the
 * 2025-26 cutover year, whose payment status lives in the prod RTDB roster).
 * Exported so the page can decide whether to fetch the legacy status without
 * duplicating the predicate the model uses internally.
 */
export function isLegacyBvPeriod(enrollments: EnrollmentWithOffering[]): boolean {
  const offering = selectBalaViharEnrollment(enrollments)?.offering ?? null;
  if (!offering) return false;
  return activeBvPaymentSource(enrollments) === 'legacy';
}

function activeBvPaymentSource(enrollments: EnrollmentWithOffering[]): PaymentSource {
  const offering = selectBalaViharEnrollment(enrollments)?.offering ?? null;
  if (!offering) return 'portal';
  return paymentSourceOf(
    offering.paymentSource !== undefined ? { paymentSource: offering.paymentSource } : {},
  );
}

/** A single actionable item on the dashboard's "Action Items" panel. Additive:
 *  Slice 2 will add a `{ kind: 'disclaimers'; … }` variant. Kept UI-path-free so
 *  the mobile API can serialize it and the client builds its own navigation. */
export type ActionItem = { kind: 'donation'; title: string; ctaLabel: string };

export interface DashboardModelInput {
  /** All of the family's enrollments, joined with offerings (any sort order). */
  enrollments: EnrollmentWithOffering[];
  /** All of the family's donations. */
  donations: DonationDoc[];
  /** Program docs keyed by programKey (for capability-aware cards). */
  programsById: Map<string, ProgramDoc>;
  /**
   * Legacy roster payment status, fetched by the caller ONLY when
   * `isLegacyBvPeriod(enrollments)` is true; null otherwise. Compared `=== 'paid'`.
   */
  legacyPaymentStatus: string | null;
  /**
   * present+late BV attendance marks inside the active BV offering's window
   * (computed by the loader via getFamilyBalaViharAttendance); 0 when none.
   */
  bvAttendedCount: number;
}

export interface FamilyDashboardModel {
  /** True when the family has an active Bala Vihar enrollment (doc exists). */
  isEnrolled: boolean;
  /**
   * Three-state engagement (issue #23): 'enrolled' = active BV doc AND confirmed
   * (attended ≥1 class, a completed donation for its eid, or legacy-paid);
   * 'registered' = active BV doc but not yet engaged; 'none' = no active BV.
   */
  bvState: 'enrolled' | 'registered' | 'none';
  /**
   * True ⟺ bvState === 'registered' — drives the confirm nudge line and the
   * registered donate CTA on both layouts.
   */
  confirmNudge: boolean;
  /** Members actually enrolled in BV (enrolledMids), NOT all Child members. */
  kidsEnrolled: number;
  enrollPeriodLabel: string | null;
  suggestedAmount: number | null;
  givenForPeriod: number;
  /** Active BV enrollment id (null when not enrolled) — drives the direct-to-Stripe donate button. */
  eid: string | null;
  donateUrl: string;
  isLegacyPeriod: boolean;
  legacyPaid: boolean;
  /** True when the active BV offering's payment is collected by the teacher
   *  off-portal — there is no in-portal donation to make or track. */
  teacherManaged: boolean;
  /** One card per active NON-BV enrollment (BV has its own bespoke section). */
  otherProgramCards: ProgramCard[];
  donation: {
    complete: boolean;
    pct: number;
    /** null (not undefined) for exactOptionalPropertyTypes-friendly spreading. */
    tone: 'ok' | 'warn' | null;
    showGive: boolean;
    showProgress: boolean;
    heading: string;
  };
  enrolledPill: { text: string; bg: string; fg: string };
  actionItems: ActionItem[];
}

/**
 * Pure derivation of the family dashboard's BV-bespoke view model. The page
 * fetches the raw data and renders this; ALL the branching logic lives here so
 * it can be unit-tested with multi-enrollment fixtures.
 *
 * Critically, the BV card / donation both resolve through
 * `selectBalaViharEnrollment` — pinned to the active *Bala Vihar* enrollment —
 * so a newer non-BV enrollment (e.g. Tabla) cannot hijack the section. Every
 * non-BV enrollment surfaces separately via `deriveProgramCards`.
 */
export function buildFamilyDashboardModel(input: DashboardModelInput): FamilyDashboardModel {
  const { enrollments, donations, programsById, legacyPaymentStatus } = input;

  const bv = selectBalaViharEnrollment(enrollments);
  const isEnrolled = bv !== null;
  const kidsEnrolled = bv?.enrolledMids.length ?? 0;

  const enrollPeriodLabel = bv?.termLabel ?? null;
  const suggestedAmount = bv?.effectiveSuggestedAmount ?? null;
  const givenForPeriod = bv
    ? donations
        .filter((d) => d.status === 'completed' && d.eid === bv.eid)
        .reduce((sum, d) => sum + d.amountCAD, 0)
    : 0;
  const donateUrl = bv ? `/family/donate?eid=${bv.eid}` : '/family/donate';

  const isLegacyPeriod = isLegacyBvPeriod(enrollments);
  const teacherManagedPayment = activeBvPaymentSource(enrollments) === 'teacher-managed';
  const legacyPaid = isLegacyPeriod && legacyPaymentStatus === 'paid';

  // Issue #23: an active BV doc alone is only 'registered'. 'enrolled' requires
  // real engagement — attendance, a completed donation for its eid, or legacy-paid.
  const bvConfirmed =
    bv !== null &&
    isEnrollmentConfirmed(bv, { attendedCount: input.bvAttendedCount, donations, legacyPaid });
  const bvState: 'enrolled' | 'registered' | 'none' =
    bv === null ? 'none' : bvConfirmed ? 'enrolled' : 'registered';
  const confirmNudge = bvState === 'registered';

  const otherProgramCards = deriveProgramCards(enrollments, programsById).filter(
    (c) => c.programKey !== 'bala-vihar',
  );

  const donationComplete = suggestedAmount !== null && givenForPeriod >= suggestedAmount;
  const donationPct =
    suggestedAmount && suggestedAmount > 0
      ? Math.min(100, Math.round((givenForPeriod / suggestedAmount) * 100))
      : 0;
  const donationTone: 'ok' | 'warn' | null = !isEnrolled
    ? null
    : legacyPaid || donationComplete
      ? 'ok'
      : 'warn';
  // General giving is handled off-portal (CMT decision 2026-06-04) — only an
  // enrolled family with an unpaid portal-managed donation sees an in-portal Give button.
  const showGive = isEnrolled && !legacyPaid && !teacherManagedPayment;
  const showProgress = isEnrolled && suggestedAmount !== null && !legacyPaid && !teacherManagedPayment;
  const donationHeading = !isEnrolled
    ? 'Bala Vihar donation'
    : legacyPaid
      ? 'Completed'
      : isLegacyPeriod
        ? 'Bala Vihar payment pending'
        : teacherManagedPayment
          ? 'Payment managed by teacher'
        : donationComplete
          ? 'Thank you for your donation'
          : 'Bala Vihar donation pending';
  // Vaibhav feedback (2026-07-04): families should read one word — "Enrolled" —
  // for any active BV enrollment. The issue #23 engagement split lives on in
  // `bvState`/`confirmNudge` (the mobile API + the "Complete donation" nudge still
  // consume them), but the web pill no longer surfaces the interim amber
  // "Registered" state; enrolled and registered both render the accent "Enrolled".
  const enrolledPill =
    bvState === 'none'
      ? { text: 'Not enrolled', bg: 'var(--surface2)', fg: 'var(--muted)' }
      : { text: 'Enrolled', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' };

  // Slice 1 (owner decision 2026-07-03): the Bala Vihar donation is surfaced by
  // the BV section's "Complete donation" button, NOT as an Action Item — so it is
  // never double-prompted. actionItems stays the extensibility seam; Slice 2
  // populates it with the disclaimers-to-accept item.
  const actionItems: ActionItem[] = [];

  return {
    isEnrolled,
    bvState,
    confirmNudge,
    kidsEnrolled,
    enrollPeriodLabel,
    suggestedAmount,
    givenForPeriod,
    eid: bv?.eid ?? null,
    donateUrl,
    isLegacyPeriod,
    legacyPaid,
    teacherManaged: teacherManagedPayment,
    otherProgramCards,
    donation: {
      complete: donationComplete,
      pct: donationPct,
      tone: donationTone,
      showGive,
      showProgress,
      heading: donationHeading,
    },
    enrolledPill,
    actionItems,
  };
}
