import { paymentSourceOf } from '@cmt/shared-domain';
import type { PaymentSource } from '@cmt/shared-domain';
import type { DonationDoc, ProgramDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { selectBalaViharEnrollment } from './select-bv-enrollment';
import { deriveProgramCards, type ProgramCard } from './derive-program-cards';
import { isEnrollmentConfirmed } from './enrollment-confirmation';

/**
 * Amber "not-yet-confirmed" chip for the Registered pill. Reuses the same
 * warn-soft / warn token pair as the prasad "Proposed" status chip
 * (features/setu/prasad/admin-prasad-screen.tsx) and the attendance "Late" chip
 * (app/welcome/levels/[levelId]/page.tsx). `--setu-warn-soft` (#fbe6c6) is a
 * root token; `--warn` (#a06410) is the .csp-scoped alias the existing pill's
 * `--accentDeep` fg shares. No new tokens invented (issue #23).
 */
const REGISTERED_BG = 'var(--setu-warn-soft)';
const REGISTERED_FG = 'var(--warn, #a06410)';

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
  const enrolledPill =
    bvState === 'enrolled'
      ? { text: 'Enrolled', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' }
      : bvState === 'registered'
        ? { text: 'Registered', bg: REGISTERED_BG, fg: REGISTERED_FG }
        : { text: 'Not enrolled', bg: 'var(--surface2)', fg: 'var(--muted)' };

  // Derived action items (Slice 1). Donation is the only item today; it appears
  // only when the family is enrolled, the donation is portal-managed (showGive),
  // and it isn't already complete. Disclaimers (Slice 2) will append here.
  const actionItems: ActionItem[] = [];
  if (showGive && !donationComplete) {
    actionItems.push({ kind: 'donation', title: 'Complete your Bala Vihar donation', ctaLabel: 'Donate' });
  }

  return {
    isEnrolled,
    bvState,
    confirmNudge,
    kidsEnrolled,
    enrollPeriodLabel,
    suggestedAmount,
    givenForPeriod,
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
