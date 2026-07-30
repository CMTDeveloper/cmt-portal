import 'server-only';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import {
  getCheckoutSessionResult,
  createMonthlySubscription,
  getSubscriptionResult,
} from './stripe-pad-client';
import { activatePledgeAndNotify, claimPledgeTransition } from './activate-pledge';
import { bvEmailRecipient } from '@/features/setu/donations/bv-enrollment-emails';

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
    // Persist the handle IMMEDIATELY, and NEVER conditionally on status.
    //
    // If the process dies before step 5, the next pass needs this to finish the
    // job; without it the subscription exists at Stripe with nothing here
    // pointing at it. And in the racing window the guard above cannot close, a
    // subscription may exist against a pledge that is no longer `started` -
    // recording its id is then the only trace of a live debit. Refusing that
    // write would make an untracked recurring charge invisible, which is
    // strictly worse than a document whose handle and status disagree.
    //
    // But a recorded id that nothing ever surfaces is not "findable", it is
    // merely present. So the same transaction that records it also RAISES A
    // FLAG on the genuinely anomalous cases. A transaction rather than a
    // read-then-write because the flag must describe the same instant as the
    // write it annotates.
    //
    // ── What counts as anomalous is the SUBSCRIPTION, not the status ─────────
    // An earlier version flagged whenever the status had left `started`, and
    // that over-fired on the ordinary CONVERGENT race: cron and browser both
    // pass the read above while the pledge really is `started`, both call step
    // 4, the idempotency key holds and hands both the SAME id, and whichever
    // lands second finds a pledge another caller already carried to `active`.
    // Nothing is wrong there - one subscription, one email - yet it raised
    // "verify in Stripe" on a healthy pledge. Under routine cron/browser overlap
    // that is a monitor firing on healthy rows, which is precisely the trap this
    // flag exists to avoid.
    //
    // Comparing the ids instead is both narrower AND wider: it drops that false
    // alarm, and it catches a case the status check missed entirely - two
    // DIFFERENT ids for one pledge, meaning the provider's idempotency did not
    // hold and the family has two live debits. That can happen while the status
    // is still `started`, so nothing about the status would have looked wrong.
    //
    // (Still deliberately NOT keyed on `status IN (cancelled, failed) AND
    // subscriptionId != null`: that is the NORMAL steady state, since
    // `cancel-pledge.ts` does not clear the handle and a step-5 failure keeps
    // it, so it would match almost every settled pledge.)
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) {
        // Nothing in the shipped code deletes a pledge, so this is defensive -
        // but a live subscription with no document to record it is the one
        // outcome nothing downstream could ever find, so it must not be silent.
        console.error(
          '[pledge] subscription %s created for %s but the document is gone - VERIFY IN STRIPE',
          subscriptionId,
          pid,
        );
        return;
      }
      const data = snap.data() as { status?: PledgeStatus; subscriptionId?: string | null };
      const existing = data.subscriptionId ?? null;

      if (existing !== null && existing !== subscriptionId) {
        // TWO subscriptions for one pledge. Keep the FIRST id - it may already
        // be activated and tracked - and carry the second in the message, so
        // both remain recoverable from the document. Overwriting would lose the
        // only pointer to one of two live debits.
        txn.update(ref, {
          lastCheckedAt: new Date(),
          needsStripeVerification: true,
          lastError: `TWO subscriptions for this pledge: ${existing} (kept) and ${subscriptionId} - the idempotency key did not hold. Verify in Stripe.`,
        });
        return;
      }

      // A novel id landing on a pledge that has already settled: the portal
      // created a debit nobody expected. `existing === subscriptionId` means
      // someone already recorded this exact subscription - nothing new to
      // verify, whatever the status now says.
      const flag =
        existing === null && data.status !== 'started'
          ? {
              needsStripeVerification: true,
              lastError: `subscription ${subscriptionId} created after status left started (${data.status ?? 'missing'}) - verify in Stripe`,
            }
          : {};
      txn.update(ref, {
        subscriptionId,
        customerId: sub.customerId ?? null,
        lastCheckedAt: new Date(),
        ...flag,
      });
    });
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
  const recipient = pledge.fid
    ? await managerRecipientFor(db, pledge.fid)
    : { email: null, name: '' };
  // `subscriptionId` here is THIS caller's own, and step 5 above confirmed it
  // live. In the divergent case the document keeps a different (first-written)
  // id, so recording which one was actually verified is what stops a human
  // acting on the wrong subscription.
  const claim = await activatePledgeAndNotify(db, {
    pid,
    toEmail: recipient.email,
    toName: recipient.name,
    monthlyAmountCAD,
    verifiedSubscriptionId: subscriptionId,
  });
  // NOT a hardcoded 'active'. Losing the claim can mean someone else activated
  // it (fine, still active) or that a concurrent pass settled it `failed` or the
  // temple cancelled it - and reporting `active` for those told the family's
  // browser their gift was working while the record said otherwise.
  return outcomeOf(claim.status);
}

/**
 * The family's first manager, for the activation notice. Never throws.
 *
 * Returns the NAME as well as the address because CMT's `bv_enrolled_*`
 * templates open "Dear {{registrant_name}}," and SES does not fail a send on an
 * unfilled placeholder - it renders "Dear ," and still reports success. The
 * name therefore has to be fetched wherever the address is, or the omission is
 * invisible until a family says something.
 *
 * `name` falls back to the empty string, never to a guess. A blank greeting is
 * a poor email; a confidently wrong name is worse.
 */
export interface ManagerRecipient {
  email: string | null;
  name: string;
}

export async function managerRecipientFor(
  db: FirebaseFirestore.Firestore,
  fid: string,
): Promise<ManagerRecipient> {
  try {
    const fam = await db.collection('families').doc(fid).get();
    const managers = ((fam.data()?.managers ?? []) as string[]) ?? [];
    if (managers.length === 0) return { email: null, name: '' };

    // EVERY manager, not `managers[0]`. Reading only the first meant a family
    // whose first manager has no address got NO activation email at all, even
    // when a reachable co-manager was the one who started the pledge - and if
    // that first manager had an address but no name, the letter opened
    // "Dear ,". Found by a Codex review, 2026-07-30.
    //
    // By document id rather than a collection query: a family has one or two
    // managers, so this is one or two point reads, and it does not drag the
    // whole members collection onto the pledge-activation path.
    const members = await Promise.all(
      managers.map(async (mid) => {
        const m = await db.collection('families').doc(fid).collection('members').doc(mid).get();
        const x = m.data() as { email?: unknown; firstName?: unknown; lastName?: unknown } | undefined;
        return {
          mid,
          email: typeof x?.email === 'string' && x.email !== '' ? x.email : null,
          firstName: typeof x?.firstName === 'string' ? x.firstName : null,
          lastName: typeof x?.lastName === 'string' ? x.lastName : null,
        };
      }),
    );

    // The SHARED chooser, so this path and the donation paths address a family
    // the same way rather than by two hand-rolled rules.
    const chosen = bvEmailRecipient(members, null, managers);
    return { email: chosen.to ?? null, name: chosen.registrantName };
  } catch {
    return { email: null, name: '' };
  }
}
