import 'server-only';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from './get-donations';
import { getLegacyPaymentStatus } from './legacy-payment';
import { getFamilyPledge } from '@/features/setu/pledges/get-family-pledge';
import { isPledgeGiving } from '@cmt/shared-domain/setu';
import { isBalaViharPaid } from '@/features/setu/adult-class/needs-selection';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { isLegacyBvPeriod } from '@/app/family/_helpers/dashboard-model';

export interface BvUnpaidResult {
  /** The active Bala Vihar enrollment's eid, or null when there is none. */
  eid: string | null;
  /** True ONLY when there is a BV enrollment AND it is genuinely unpaid. */
  unpaid: boolean;
}

/**
 * "Does this family owe the Bala Vihar donation right now?" - the single
 * question behind every `bv_enrolled_donation_pending` send.
 *
 * ── Why this is shared ──────────────────────────────────────────────────────
 * Two triggers ask it (the family backing out of Stripe, and the door), and a
 * Codex review, 2026-07-30, found the cancel path had simply not asked: a family
 * who had ALREADY PAID Bala Vihar and then abandoned a Tabla or adult-class
 * checkout was told their Bala Vihar enrollment was not confirmed. Two
 * hand-rolled copies of this rule would drift, and this one decides whether the
 * temple tells a family they still owe money.
 *
 * `isBalaViharPaid` is the SAME helper the adult-class fee waiver uses, so
 * "paid" cannot mean one thing to the waiver and another to this letter. It
 * counts an active monthly pledge as paid, which matters: a pledging family owes
 * nothing further and must never receive the pending notice.
 *
 * Selects by programKey, never "first active" - a Tabla or adult-class
 * enrollment would otherwise stand in for Bala Vihar.
 *
 * NEVER THROWS. On any read failure it reports `unpaid: false`, i.e. SAY
 * NOTHING: the cost of silence is a family seeing an outstanding donation they
 * can already see on their dashboard, and the cost of a wrong send is telling a
 * family who has paid that they have not.
 */
export async function resolveBvUnpaid(
  fid: string,
  legacyFid: string | null | undefined,
): Promise<BvUnpaidResult> {
  try {
    const enrollments = await getEnrollments(fid);
    const bv = selectBalaViharEnrollment(enrollments);
    if (!bv) return { eid: null, unpaid: false };

    const [donations, pledge, legacyPaymentStatus] = await Promise.all([
      getDonations(fid),
      getFamilyPledge(fid),
      // The legacy leg reads the ENTIRE prod roster, so only pay for it when the
      // offering is actually legacy-sourced - the same predicate the dashboard
      // and the adult-class gate use, so the three cannot disagree about which
      // families it applies to.
      isLegacyBvPeriod(enrollments)
        ? getLegacyPaymentStatus(legacyFid)
        : Promise.resolve('unknown'),
    ]);

    const paid = isBalaViharPaid({
      bv,
      donations,
      legacyPaymentStatus,
      hasActivePledge: isPledgeGiving(pledge),
    });
    return { eid: bv.eid, unpaid: !paid };
  } catch (err) {
    console.error(`[bv-email] could not decide whether ${fid} owes Bala Vihar`, err);
    return { eid: null, unpaid: false };
  }
}
