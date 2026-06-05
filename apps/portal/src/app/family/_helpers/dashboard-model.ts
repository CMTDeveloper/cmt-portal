import { paymentSourceOf } from '@cmt/shared-domain';
import type { DonationDoc, ProgramDoc, OfferingDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import {
  summarizeFamilyCheckIns,
  type CheckInRecord,
  type CheckInSummary,
} from '@/features/setu/attendance/check-in-attendance';
import { selectBalaViharEnrollment } from './select-bv-enrollment';
import { deriveProgramCards, type ProgramCard } from './derive-program-cards';

/** YYYY-MM-DD in America/Toronto — the project-wide canonical day boundary. */
export function torontoYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

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
  /** Raw check-in records from the standalone check-in app (read-only). */
  rawCheckIns: CheckInRecord[];
  /** Class Sundays held so far this year (calendar) — the honest denominator. */
  classSundaysHeld: number;
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
  /** Family-level check-in summary, scoped to the BV offering's window. */
  attendance: {
    summary: CheckInSummary;
    hasAttendance: boolean;
    total: number;
    pct: number;
  };
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
 * Critically, the BV card / donation / attendance all resolve through
 * `selectBalaViharEnrollment` — pinned to the active *Bala Vihar* enrollment —
 * so a newer non-BV enrollment (e.g. Tabla) cannot hijack the section or scope
 * attendance to a window with no check-ins. Every non-BV enrollment surfaces
 * separately via `deriveProgramCards`.
 */
export function buildFamilyDashboardModel(input: DashboardModelInput): FamilyDashboardModel {
  const { enrollments, donations, programsById, rawCheckIns, classSundaysHeld, legacyPaymentStatus } =
    input;

  const bv = selectBalaViharEnrollment(enrollments);
  const isEnrolled = bv !== null;
  const kidsEnrolled = bv?.enrolledMids.length ?? 0;
  const offering: OfferingDoc | null = bv?.offering ?? null;

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

  // Attendance scoped to the BV offering window (a prior year's records must not
  // show under this year's enrollment). With no active BV offering, no scoping.
  const scoped = offering
    ? rawCheckIns.filter((r) => {
        const start = torontoYmd(offering.startDate);
        const end = offering.endDate ? torontoYmd(offering.endDate) : '9999-12-31';
        return r.date >= start && r.date <= end;
      })
    : rawCheckIns;
  const summary = summarizeFamilyCheckIns(scoped);
  const hasAttendance = summary.recorded > 0;
  const attendanceTotal = classSundaysHeld > 0 ? classSundaysHeld : summary.recorded;
  const attendancePct =
    attendanceTotal > 0 ? Math.round((summary.attended / attendanceTotal) * 100) : 0;

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
    ? 'Donation'
    : legacyPaid
      ? 'Paid'
      : isLegacyPeriod
        ? 'Payment pending'
        : donationComplete
          ? 'Thank you for your donation'
          : 'Donation pending';
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
    attendance: { summary, hasAttendance, total: attendanceTotal, pct: attendancePct },
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
