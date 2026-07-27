import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import {
  getCheckoutSessionResult,
  createMonthlySubscription,
  getSubscriptionResult,
} from './stripe-pad-client';
import { activatePledgeAndNotify } from './activate-pledge';

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
 * Finish a pledge after the family returns from the Stripe-hosted page:
 * step 3 (did the mandate land?) → step 4 (create the subscription) → step 5
 * (is it live?).
 *
 * ── ONE pass, never a poll ──────────────────────────────────────────────────
 * Vaibhav was explicit: do not loop. Each call is made at most once here, and
 * anything still unresolved is the reconciler's job. A retry loop in a request
 * handler turns a slow provider into a hung page and, worse, invites duplicate
 * subscription attempts.
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

  const pledge = snap.data() as {
    fid?: string;
    status?: PledgeStatus;
    setupSessionId?: string | null;
    subscriptionId?: string | null;
    monthlyAmountCAD?: number;
  };
  // Ownership is checked against the SESSION's fid, so knowing a pid is not
  // enough to drive another family's pledge to a terminal state.
  if (pledge.fid !== args.fid) return { state: 'not-yours' };

  // Idempotent by state, not by flag: re-finalizing an already-settled pledge
  // reports what it is and touches nothing.
  if (pledge.status === 'active') return { state: 'active' };
  if (pledge.status === 'failed' || pledge.status === 'cancelled') return { state: 'failed' };
  if (!pledge.setupSessionId) {
    // `started` with no session means the provider call never landed at start.
    // There is nothing to ask about, and leaving it `started` would block the
    // family from trying again.
    await ref.update({ status: 'failed' satisfies PledgeStatus, lastError: 'no setup session' });
    return { state: 'failed' };
  }

  const monthlyAmountCAD = typeof pledge.monthlyAmountCAD === 'number' ? pledge.monthlyAmountCAD : 51;
  const email = await managerEmailFor(db, pledge.fid);

  // ── Step 3: did the family actually complete the hosted mandate page? ──────
  let subscriptionId = pledge.subscriptionId ?? null;
  if (!subscriptionId) {
    const mandate = await getCheckoutSessionResult(pledge.setupSessionId);
    if (mandate === 'failed') {
      await ref.update({ status: 'failed' satisfies PledgeStatus, lastCheckedAt: new Date() });
      return { state: 'failed' };
    }
    if (mandate === 'pending') {
      // Stays `started`. The card says "we're setting up your monthly gift",
      // which is the honest reading - nothing has been confirmed.
      await ref.update({ lastCheckedAt: new Date() });
      return { state: 'processing' };
    }

    // ── Step 4: turn the confirmed mandate into the subscription ─────────────
    const sub = await createMonthlySubscription({ setupSessionId: pledge.setupSessionId, pid: args.pid });
    subscriptionId = sub.subscriptionId;
    // Persist the handle IMMEDIATELY. If the process dies before step 5, the
    // reconciler needs this to finish the job; without it the subscription
    // exists at Stripe with nothing here pointing at it.
    await ref.update({ subscriptionId, customerId: sub.customerId ?? null, lastCheckedAt: new Date() });
  }

  // ── Step 5: is that subscription actually live? ───────────────────────────
  const live = await getSubscriptionResult(subscriptionId);
  if (live === 'failed') {
    await ref.update({ status: 'failed' satisfies PledgeStatus, lastCheckedAt: new Date() });
    return { state: 'failed' };
  }
  if (live === 'pending') {
    await ref.update({ lastCheckedAt: new Date() });
    return { state: 'processing' };
  }

  // Activation goes through the shared transactional claim, so this path and
  // the reconciler cron cannot both announce the same activation.
  await activatePledgeAndNotify(db, { pid: args.pid, toEmail: email, monthlyAmountCAD });
  return { state: 'active' };
}

/** The family's first manager's email, for the activation notice. Never throws. */
async function managerEmailFor(db: FirebaseFirestore.Firestore, fid: string): Promise<string | null> {
  try {
    const fam = await db.collection('families').doc(fid).get();
    const managers = (fam.data()?.managers ?? []) as string[];
    const mid = managers[0];
    if (!mid) return null;
    const m = await db.collection('families').doc(fid).collection('members').doc(mid).get();
    const email = (m.data() as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' && email !== '' ? email : null;
  } catch {
    return null;
  }
}
