import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { allocateFamilyPublicId } from '@/features/setu/ids/public-id-allocator';

/**
 * Idempotently mint a family's user-facing publicFid (the 5001+ Family ID) - the
 * single place a publicFid is assigned under lazy minting (Model Y2). Called when
 * a family becomes engaged: at its first enrollment (enrollFamily) and when a
 * carry-forward family is confirmed present (teacher confirm-previous). Both are
 * enrollment events in Vaibhav's model - "in Setu with an ID once the family engaged".
 *
 * - Returns the EXISTING publicFid untouched when the family already has one, so
 *   re-enrollments / multi-program families / repeat confirmations never burn an
 *   id from the bounded 5001+ band.
 * - Allocates OUTSIDE the mint transaction (the allocator opens its own Firestore
 *   transaction and Firestore forbids nested transactions), then writes it INSIDE
 *   a transaction only if the family still has none - a concurrent mint that won
 *   the race keeps its id and the freshly-allocated one goes unused (a harmless
 *   gap; ids need not be contiguous).
 * - Returns null when the family doc does not exist (nothing to mint).
 */
export async function ensurePublicFid(fid: string): Promise<string | null> {
  const db = portalFirestore();
  const ref = db.collection('families').doc(fid);

  const snap = await ref.get();
  if (!snap.exists) return null;
  const existing = snap.data()?.['publicFid'];
  if (existing) return existing as string;

  const publicFid = await allocateFamilyPublicId();
  return db.runTransaction(async (txn) => {
    const current = (await txn.get(ref)).data()?.['publicFid'];
    if (current) return current as string;
    txn.update(ref, { publicFid });
    return publicFid;
  });
}
