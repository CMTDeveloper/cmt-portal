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
export async function markDonationStatus(
  did: string,
  fid: string,
  status: DonationStatus,
): Promise<boolean> {
  const db = portalFirestore();
  const ref = db.collection('donations').doc(did);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const data = snap.data();
  if (!data || data['fid'] !== fid) return false;

  // Don't let a late 'cancel' redirect clobber a 'completed' donation.
  if (data['status'] === 'completed' && status === 'abandoned') return true;

  await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  return true;
}
