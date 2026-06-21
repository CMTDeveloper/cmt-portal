import { paymentSourceOf } from '@cmt/shared-domain';
import type { DonationDoc, ProgramDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { selectBalaViharEnrollment } from './select-bv-enrollment';
import { deriveProgramCards, type ProgramCard } from './derive-program-cards';

/**
 * True when the active Bala Vihar enrollment's offering is legacy-sourced (the
 * 2025-26 cutover year, whose payment status lives in the prod RTDB roster).
 * Exported so the page can decide whether to fetch the legacy status without
 * duplicating the predicate the model uses internally.
 */
export function isLegacyBvPeriod(enrollments: EnrollmentWithOffering[]): boolean {
  const offering = selectBalaViharEnrollment(enrollments)?.offering ?? null;
  if (!offering) return false;
  return (
    paymentSourceOf(
      offering.paymentSource !== undefined ? { paymentSource: offering.paymentSource } : {},
    ) === 'legacy'
  );
}

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
}

export interface FamilyDashboardModel {
  /** True when the family has an active Bala Vihar enrollment. */
  isEnrolled: boolean;
  /** Members actually enrolled in BV (enrolledMids), NOT all Child members. */
  kidsEnrolled: number;
  enrollPeriodLabel: string | null;
  suggestedAmount: number | null;
  givenForPeriod: number;
  donateUrl: string;
  isLegacyPeriod: boolean;
  legacyPaid: boolean;
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
  const legacyPaid = isLegacyPeriod && legacyPaymentStatus === 'paid';

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
  // enrolled family with an unpaid dakshina sees an in-portal Give button.
  const showGive = isEnrolled && !legacyPaid;
  const showProgress = isEnrolled && suggestedAmount !== null && !legacyPaid;
  const donationHeading = !isEnrolled
    ? 'Bala Vihar donation'
    : legacyPaid
      ? 'Completed'
      : isLegacyPeriod
        ? 'Bala Vihar payment pending'
        : donationComplete
          ? 'Thank you for your donation'
          : 'Bala Vihar donation pending';
  const enrolledPill = isEnrolled
    ? { text: 'Enrolled', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' }
    : { text: 'Not enrolled', bg: 'var(--surface2)', fg: 'var(--muted)' };

  return {
    isEnrolled,
    kidsEnrolled,
    enrollPeriodLabel,
    suggestedAmount,
    givenForPeriod,
    donateUrl,
    isLegacyPeriod,
    legacyPaid,
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
  };
}
