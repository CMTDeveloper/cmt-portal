import 'server-only';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import {
  getCheckoutSessionResult,
  createMonthlySubscription,
  getSubscriptionResult,
} from './stripe-pad-client';
import { activatePledgeAndNotify, claimPledgeTransition } from './activate-pledge';

/** What one pass of the state machine concluded. */
export type AdvanceOutcome = 'active' | 'processing' | 'failed';

/**
 * What the pledge's PERSISTED status means to a caller reporting an outcome.
 *
 * Every settled return goes through this rather than echoing the answer this
 * pass happened to get, so the caller and the document can never disagree. A
 * missing document reads as `processing` - unresolved is the honest report for
 * something we can no longer see, and it is not a state a caller should act on.
 */
function outcomeOf(status: PledgeStatus | null): AdvanceOutcome {
  if (status === 'active') return 'active';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'processing';
}

/** The fields of a pledge document this state machine reads. */
export interface AdvancePledgeDoc {
  fid?: string;
  status?: PledgeStatus;
  setupSessionId?: string | null;
  subscriptionId?: string | null;
  monthlyAmountCAD?: number;
}

/**
 * Steps 3 → 4 → 5 for ONE pledge: did the mandate land, turn it into a
 * subscription, is that subscription live.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * TWO callers drive this transition: the family returning from the hosted page
 * (`finalizePledge`) and the daily reconciler cron. Written twice, the two
 * copies drift - and the thing that drifts is a state machine that decides
 * whether money is moving. There is exactly one here, and the callers differ
 * only in how they find the pledge and what they do with the outcome.
 *
 * ── ONE pass, never a poll ──────────────────────────────────────────────────
 * Vaibhav was explicit: do not loop. Each provider call is made at most once.
 * Anything still unresolved is the NEXT cron run's job. A retry loop inside a
 * request handler turns a slow provider into a hung page and invites duplicate
 * subscription attempts.
 *
 * ── Provider errors THROW ───────────────────────────────────────────────────
 * They are not an outcome. The route turns a throw into a 503; the cron records
 * it on the row and carries on to the next family. Folding them into `failed`
 * here would let one bad afternoon at Stripe mark a queue of good pledges dead.
 */
export async function advancePledge(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  pledge: AdvancePledgeDoc,
  pid: string,
): Promise<AdvanceOutcome> {
  // Idempotent by state, not by flag: re-running over an already-settled pledge
  // reports what it is and touches nothing.
  if (pledge.status === 'active') return 'active';
  if (pledge.status === 'failed' || pledge.status === 'cancelled') return 'failed';
  if (!pledge.setupSessionId) {
    // `started` with no session means the provider call never landed at start.
    // There is nothing to ask about, and leaving it `started` would block the
    // family from ever trying again.
    const claim = await claimPledgeTransition(db, pid, 'failed', { lastError: 'no setup session' });
    return outcomeOf(claim.status);
  }

  const monthlyAmountCAD = typeof pledge.monthlyAmountCAD === 'number' ? pledge.monthlyAmountCAD : 51;

  // ── Step 3: did the family actually complete the hosted mandate page? ──────
  let subscriptionId = pledge.subscriptionId ?? null;
  if (!subscriptionId) {
    const mandate = await getCheckoutSessionResult(pledge.setupSessionId);
    if (mandate === 'failed') {
      const claim = await claimPledgeTransition(db, pid, 'failed', { lastCheckedAt: new Date() });
      return outcomeOf(claim.status);
    }
    if (mandate === 'pending') {
      // Stays `started`. The card says "we're setting up your monthly gift",
      // which is the honest reading - nothing has been confirmed.
      await ref.update({ lastCheckedAt: new Date() });
      return 'processing';
    }

    // ── Is this pledge STILL ours to advance? ────────────────────────────────
    // Every status WRITE below is compare-and-swapped, but a claim cannot
    // un-charge anybody - and step 4 creates a REAL recurring bank debit that
    // only the temple can stop, by hand, in Stripe. So the CALL gets its own
    // guard, not just the write that follows it.
    //
    // The early returns at the top of this function read the CALLER'S SNAPSHOT,
    // taken before a step-3 round trip that may have taken hundreds of ms. An
    // admin cancel, or a concurrent pass, landing in that window sails straight
    // past them. A fresh read here narrows the window from a whole provider
    // round trip to a single Firestore read.
    //
    // It cannot close the window - two callers can both pass this read - which
    // is exactly why the deterministic idempotency key matters, and why the
    // payment service honouring it is on the pre-flip checklist.
    const fresh = await ref.get();
    const freshStatus = (fresh.data() as { status?: PledgeStatus } | undefined)?.status ?? null;
    if (freshStatus !== 'started') return outcomeOf(freshStatus);

    // ── Step 4: turn the confirmed mandate into the subscription ─────────────
    // THIS is the orphan-mandate repair. If the browser died here, the family
    // has a live mandate at Stripe and no subscription - no money moves, and
    // they believe they are giving. Retried with the same setupSessionId and
    // the same derived idempotency key, so a retry resumes rather than duplicates.
    const sub = await createMonthlySubscription({ setupSessionId: pledge.setupSessionId, pid });
    subscriptionId = sub.subscriptionId;
    // Persist the handle IMMEDIATELY, and DELIBERATELY UNGUARDED - the only
    // write here that is not compare-and-swapped.
    //
    // If the process dies before step 5, the next pass needs this to finish the
    // job; without it the subscription exists at Stripe with nothing here
    // pointing at it. And in the racing case the guard above cannot fully close,
    // a subscription may exist against a pledge that is no longer `started` -
    // recording its id is then the ONLY thing that makes that live debit
    // findable by a human. Guarding this write would make an untracked recurring
    // charge invisible, which is strictly worse than a document whose handle and
    // status disagree.
    await ref.update({ subscriptionId, customerId: sub.customerId ?? null, lastCheckedAt: new Date() });
  }

  // ── Step 5: is that subscription actually live? ───────────────────────────
  const live = await getSubscriptionResult(subscriptionId);
  if (live === 'failed') {
    const claim = await claimPledgeTransition(db, pid, 'failed', { lastCheckedAt: new Date() });
    return outcomeOf(claim.status);
  }
  if (live === 'pending') {
    await ref.update({ lastCheckedAt: new Date() });
    return 'processing';
  }

  // Activation goes through the shared transactional claim, so this path and a
  // concurrent one cannot both announce the same activation to the same family.
  const email = pledge.fid ? await managerEmailFor(db, pledge.fid) : null;
  const claim = await activatePledgeAndNotify(db, { pid, toEmail: email, monthlyAmountCAD });
  // NOT a hardcoded 'active'. Losing the claim can mean someone else activated
  // it (fine, still active) or that a concurrent pass settled it `failed` or the
  // temple cancelled it - and reporting `active` for those told the family's
  // browser their gift was working while the record said otherwise.
  return outcomeOf(claim.status);
}

/** The family's first manager's email, for the activation notice. Never throws. */
export async function managerEmailFor(
  db: FirebaseFirestore.Firestore,
  fid: string,
): Promise<string | null> {
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
