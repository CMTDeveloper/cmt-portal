import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';

/**
 * The family dashboard's top section — the "Bala Vihar" card, the Donation card,
 * and the attendance heatmap — is BV-bespoke. Attendance in particular comes
 * from the standalone check-in app's `family-check-ins` collection, which is a
 * Bala Vihar mechanism (BV's `attendanceMode` is `'check-in'`; other programs
 * are `'none'`).
 *
 * A family can hold several active enrollments at once (e.g. Bala Vihar 2025-26
 * + Tabla 2026-27). `getEnrollments` sorts `enrolledAt DESC`, so the first
 * active enrollment is the most recently added one — which may NOT be Bala
 * Vihar. This helper pins the bespoke section to the active *Bala Vihar*
 * enrollment so a newer non-BV enrollment can't hijack the card's term/amount
 * or — the bug this fixes — scope attendance to a program window that has no
 * check-ins yet (making a family's real attendance silently disappear). Every
 * non-BV enrollment is surfaced separately via `deriveProgramCards`.
 *
 * Returns null when the family has no active Bala Vihar enrollment.
 */
export function selectBalaViharEnrollment(
  enrollments: EnrollmentWithOffering[],
): EnrollmentWithOffering | null {
  return (
    enrollments.find((e) => e.status === 'active' && e.programKey === 'bala-vihar') ?? null
  );
}
