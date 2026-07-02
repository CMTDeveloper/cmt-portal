import 'server-only';
import { paymentSourceOf } from '@cmt/shared-domain';
import type { RosterPayment } from '@cmt/shared-domain/setu';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getFamilyBalaViharAttendance } from '@/features/setu/attendance/get-family-attendance';
import { isEnrollmentConfirmed } from '@/app/family/_helpers/enrollment-confirmation';
import { isoToTorontoDateInput } from '@/lib/toronto-date';
import { paymentFromAmounts } from './payment';

/** null = no active Bala Vihar enrollment; see RosterFamilyRow.bvEngagement. */
export type BvEngagement = 'confirmed' | 'registered' | null;

export interface RosterFamilySignals {
  payment: RosterPayment;
  bvEngagement: BvEngagement;
}

export interface RosterFamilyContext {
  legacyFid: string | null;
  /** The family's members (mid → legacySid) for the door-attendance join. */
  members: ReadonlyArray<{ mid: string; legacySid: string | null }>;
}

/**
 * Per-family roster signals for a single row: the payment chip status AND the
 * issue #23 Bala Vihar engagement (Confirmed vs Registered). Reads the family's
 * enrollments + donations ONCE and derives both from that data — never throws
 * (a derivation failure for one family returns unknown/null so it can't break
 * the roster page, same discipline as `deriveFamilyPayment`).
 *
 * Read budget is deliberately short-circuited: donations are already in memory
 * and legacy status is a single cached roster read, so the extra
 * `getFamilyBalaViharAttendance` read only happens when a family has an active
 * BV enrollment that those cheaper signals didn't already confirm. No active BV
 * enrollment ⇒ `null` and zero extra reads.
 */
export async function deriveFamilyRosterSignals(
  fid: string,
  ctx: RosterFamilyContext,
): Promise<RosterFamilySignals> {
  try {
    const [enrollments, donations] = await Promise.all([getEnrollments(fid), getDonations(fid)]);
    const active = enrollments.filter((e) => e.status === 'active');
    const expected = active.reduce((sum, e) => sum + (e.effectiveSuggestedAmount ?? 0), 0);
    const paid = donations
      .filter((d) => d.status === 'completed')
      .reduce((sum, d) => sum + (typeof d.amountCAD === 'number' ? d.amountCAD : 0), 0);
    const payment = paymentFromAmounts(active.length, expected, paid);

    // Pin to the active *Bala Vihar* enrollment so a newer non-BV enrollment
    // can't hijack the signal (same rule as selectBalaViharEnrollment).
    const bv = active.find((e) => e.programKey === 'bala-vihar') ?? null;
    if (!bv) return { payment, bvEngagement: null };

    // Legacy-paid only matters for a legacy-sourced BV offering (the 2025-26
    // cutover year); otherwise skip the roster read entirely.
    const source = bv.offering
      ? paymentSourceOf(
          bv.offering.paymentSource !== undefined ? { paymentSource: bv.offering.paymentSource } : {},
        )
      : 'portal';
    const legacyPaid =
      source === 'legacy' ? (await getLegacyPaymentStatus(ctx.legacyFid)) === 'paid' : false;

    // Cheap signals first (donations already loaded + legacy). Only pay for the
    // attendance read when they're inconclusive.
    if (isEnrollmentConfirmed(bv, { attendedCount: 0, donations, legacyPaid })) {
      return { payment, bvEngagement: 'confirmed' };
    }

    const byMid = new Map(ctx.members.map((m) => [m.mid, m] as const));
    const children = bv.enrolledMids.map((mid) => ({ mid, legacySid: byMid.get(mid)?.legacySid ?? null }));
    // Offering boundaries store Toronto-aware timestamps (endDate is 23:59:59
    // America/Toronto, i.e. early-morning UTC the *next* day) — derive the window
    // YMDs in the Toronto calendar so they match the door check-in records (Task
    // 3 convention; a UTC .slice(0,10) would push end-of-day one day late).
    const summary = await getFamilyBalaViharAttendance({
      fid,
      legacyFid: ctx.legacyFid,
      oid: bv.oid,
      windowStart: bv.offering ? isoToTorontoDateInput(bv.offering.startDate.toISOString()) : null,
      windowEnd: bv.offering?.endDate ? isoToTorontoDateInput(bv.offering.endDate.toISOString()) : null,
      children,
    });
    const attendedCount = summary.present + summary.late;
    return {
      payment,
      bvEngagement: isEnrollmentConfirmed(bv, { attendedCount, donations, legacyPaid })
        ? 'confirmed'
        : 'registered',
    };
  } catch {
    return { payment: 'unknown', bvEngagement: null };
  }
}
