import type { LegacyLocation } from '@/features/setu/registration/legacy-parser';

/** A minimal view of an enrollment doc - only the fields the backfill decisions read. */
export type EnrollmentLite = { oid?: string; eid?: string; status?: string };

/** Bala Vihar offering id for a legacy center + school year. Scarborough maps to the
 *  Scarborough offering; every other center (Brampton / Mississauga / Markham) maps to
 *  Brampton - matching the legacy-parser mapLocation default. */
export function bvOidForCenter(center: LegacyLocation, year: string): string {
  return center === 'Scarborough' ? `bv-scarborough-${year}` : `bv-brampton-${year}`;
}

/** True for Bala Vihar offering ids (the `bv-` prefix), used to isolate BV enrollments
 *  from a family's other-program (Tabla, etc.) enrollments. */
export function isBvOid(oid: string | null | undefined): boolean {
  return typeof oid === 'string' && oid.startsWith('bv-');
}

/** Does the family already hold an ACTIVE enrollment for this exact offering? Drives the
 *  skip-guard that protects rollover-promoted families from a grade revert / overwrite. */
export function hasActiveEnrollmentForOid(enrollments: EnrollmentLite[], oid: string): boolean {
  return enrollments.some((e) => e.oid === oid && e.status === 'active');
}

/** Eids of the family's ACTIVE BV enrollments for a DIFFERENT (stale prior-year) offering,
 *  to cancel when we enroll them into the current year - keeps exactly one active BV
 *  enrollment per family. */
export function priorYearBvEidsToCancel(enrollments: EnrollmentLite[], currentOid: string): string[] {
  return enrollments
    .filter((e) => e.status === 'active' && isBvOid(e.oid) && e.oid !== currentOid && typeof e.eid === 'string')
    .map((e) => e.eid as string);
}
