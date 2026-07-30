import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import type { DonationStatus } from '@cmt/shared-domain';

/**
 * Best-effort status transition driven by the Stripe success/cancel redirect.
 * Guards cross-family writes (the did must belong to the caller's fid) and never
 * downgrades a 'completed' donation back to 'abandoned'. Returns false if the
 * donation doesn't exist or belongs to another family.
 *
 * NOTE: 'completed' here is client-trusted (no Stripe webhook in this slice).
 * Accounting's payment notification remains authoritative for tax purposes.
 */
export interface MarkDonationResult {
  /** The donation exists and belongs to this family. */
  ok: boolean;
  /**
   * The status ACTUALLY changed on this call.
   *
   * The receipt page re-runs this on every render - a reload, a back-button, a
   * shared link - so `ok` alone cannot gate anything that must happen once.
   * `changed` is true exactly once per real transition, which is what makes it
   * safe to hang the confirmation email off it. Without this the family is
   * mailed a fresh "we received your donation" every time they refresh the
   * page they are already looking at.
   *
   * It is a transaction, not a read-then-write: two concurrent renders (the
   * PPR shell and a soft nav, say) would otherwise both read 'pending' and both
   * claim the transition.
   */
  changed: boolean;
  /** Whatever the status was before this call, for logs and for the caller's own branching. */
  previousStatus: DonationStatus | null;
}

export async function markDonationStatus(
  did: string,
  fid: string,
  status: DonationStatus,
): Promise<MarkDonationResult> {
  const db = portalFirestore();
  const ref = db.collection('donations').doc(did);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { ok: false, changed: false, previousStatus: null };

    const data = snap.data();
    if (!data || data['fid'] !== fid) return { ok: false, changed: false, previousStatus: null };

    const previousStatus = (data['status'] as DonationStatus | undefined) ?? null;

    // Don't let a late 'cancel' redirect clobber a 'completed' donation.
    if (previousStatus === 'completed' && status === 'abandoned') {
      return { ok: true, changed: false, previousStatus };
    }
    // Already there. Reporting `changed: false` is the whole point: this is the
    // reloaded-receipt case.
    if (previousStatus === status) {
      return { ok: true, changed: false, previousStatus };
    }

    txn.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true, changed: true, previousStatus };
  });
}
