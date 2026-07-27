import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { advancePledge, type AdvancePledgeDoc } from './advance-pledge';

export type FinalizeOutcome =
  /** Mandate confirmed, subscription live. The family is giving. */
  | { state: 'active' }
  /** Still in flight somewhere. The reconciler finishes it; the UI must NOT claim success. */
  | { state: 'processing' }
  /** Terminally failed at the provider. The family may start again. */
  | { state: 'failed' }
  | { state: 'not-found' }
  | { state: 'not-yours' };

/**
 * Finish a pledge after the family returns from the Stripe-hosted page.
 *
 * This function owns exactly two things the cron does not: finding the pledge by
 * pid, and refusing one that is not this family's. The transition itself lives
 * in `advancePledge`, shared with the reconciler - two copies of a state machine
 * that decides whether money is moving would eventually disagree.
 *
 * ── The client can never force `active` ─────────────────────────────────────
 * Nothing in the request body influences the outcome. The status is derived
 * entirely from what the provider says about `setupSessionId` and
 * `subscriptionId`, both read from the stored document. A family-manager POSTing
 * a fabricated body gets exactly the same answer as one who posts `{}`.
 */
export async function finalizePledge(args: { pid: string; fid: string }): Promise<FinalizeOutcome> {
  const db = portalFirestore();
  const ref = db.collection('pledges').doc(args.pid);
  const snap = await ref.get();
  if (!snap.exists) return { state: 'not-found' };

  const pledge = snap.data() as AdvancePledgeDoc;
  // Ownership is checked against the SESSION's fid, so knowing a pid is not
  // enough to drive another family's pledge to a terminal state.
  if (pledge.fid !== args.fid) return { state: 'not-yours' };

  return { state: await advancePledge(db, ref, pledge, args.pid) };
}
