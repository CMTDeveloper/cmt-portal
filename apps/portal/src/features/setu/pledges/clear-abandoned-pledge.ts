import 'server-only';
import { getCheckoutSessionSubmission } from './stripe-pad-client';
import { findStartedPledge } from './find-started-pledge';
import { cancelPledgeRecord } from './cancel-pledge';
import { notifyPledgeAbandoned } from './notify-pledge-abandoned';

export type ClearAbandonedResult =
  /** There was a `started` pledge the family never submitted; it is now cleared. */
  | 'cleared'
  /** A mandate may exist. Leave every payment surface locked. */
  | 'in-play'
  /** Nothing was in flight. */
  | 'none';

/**
 * A pledge the family started but never authorised does not count as in play.
 *
 * ── The rule, in Vaibhav's words (2026-07-29) ───────────────────────────────
 * *"If someone selects the Pledge option, and not complete, then the process is
 * not complete and they need to be taken back to options again where they can
 * select donation or pledge... there is nothing for anyone to do. Neither any
 * admin or bank has anything to do. It's for family to start the donation
 * process again and complete on their own since this is complete self serve."*
 *
 * So this resolves the state rather than describing it. Call it where a family
 * arrives to pay; if it returns `cleared`, the pledge is gone and every surface
 * downstream naturally shows the normal one-time/monthly choice again. No
 * screen needs a special "you abandoned this" branch, and no admin is involved.
 *
 * ── Why it is safe to cancel here ───────────────────────────────────────────
 * 🔴 Clearing a record while a real mandate exists would let the family
 * authorise a SECOND bank debit, and the portal can stop neither - there is no
 * cancel endpoint, and the temple stops debits by hand in Stripe. So the
 * decision is never taken on our own bookkeeping: we ask the provider and act
 * only on Stripe's own statement that the hosted page was never submitted.
 * `getCheckoutSessionSubmission` fails CLOSED, and so does every step here:
 * ANY error - read, provider, or write - returns `in-play`, leaving the family
 * locked rather than exposed.
 *
 * NEVER THROWS. Callers include server components rendering a whole page, so a
 * transient Firestore blip must cost this repair and nothing else -
 * `loadPledgeSlot` takes the same care, for the same reason.
 *
 * Proven necessary, not theoretical: probing the service for a session Vaibhav
 * backed out of returned `{"state":"pending","reason":"PAD setup not completed
 * yet","stripe":{"status":"open"}}` - `pending` forever, so `advancePledge`
 * would have left that pledge `started` until the end of time.
 *
 * ── Known, bounded race (Codex review, 2026-07-29) ──────────────────────────
 * Between asking the provider and writing the cancel, a family with the hosted
 * page still open on ANOTHER device could submit the mandate;
 * `cancelPledgeRecord` re-checks only the status, not submission, so it would
 * cancel anyway. It cannot produce a double DEBIT - `advancePledge` short-
 * circuits a `cancelled` pledge before step 4, so no subscription is ever
 * created from it. What it can leave is a mandate at Stripe with no
 * subscription behind it and nothing in the portal pointing at it. Accepted:
 * it needs two live sessions on one abandoned page, and the alternative (a
 * second provider round trip inside the transaction) trades a rare orphan for
 * network I/O inside a Firestore transaction, which the SDK may retry.
 */
export interface ClearAbandonedOptions {
  /**
   * Send the "you are enrolled but the donation is not finished" letter when
   * this call is the one that clears the attempt.
   *
   * ── Defaults to TRUE, deliberately ──────────────────────────────────────────
   * The bug being fixed (Vaibhav, 2026-07-30) was an OMISSION: abandoning the
   * monthly option notified nobody, because the only notifier was keyed on a
   * donations document the pledge flow never creates. An opt-IN flag would
   * reproduce that failure the next time someone adds a call site and does not
   * know to pass it. Defaulting to send puts the safe direction on the side of
   * forgetfulness, and the 7-day cooldown inside `notifyDonationPending` bounds
   * what a mistake can cost.
   *
   * Pass `false` only where the family is RESTARTING payment in the same breath
   * - `/api/pledges/start` clears any stale attempt before creating the new one,
   * and a letter saying "your donation is not finished" sent at the instant they
   * are finishing it would be both wrong and, worse, would burn the cooldown
   * that the real abandonment needs later.
   */
  notify?: boolean;
  /** Sharpens the email's return link to this deployment. Server components have none. */
  req?: Request;
}

export async function clearAbandonedPledge(
  fid: string,
  opts: ClearAbandonedOptions = {},
): Promise<ClearAbandonedResult> {
  let started: Awaited<ReturnType<typeof findStartedPledge>>;
  try {
    started = await findStartedPledge(fid);
  } catch {
    // A read failure must not decide anything about money.
    return 'in-play';
  }
  if (!started) return 'none';

  if (started.setupSessionId) {
    try {
      const submission = await getCheckoutSessionSubmission(started.setupSessionId);
      if (submission === 'submitted') return 'in-play';
    } catch {
      // Cannot ask ⇒ cannot rule out a mandate ⇒ stay locked.
      return 'in-play';
    }
  }
  // No session id means the provider call never landed when the pledge was
  // created, so nothing can exist at Stripe. `advancePledge` treats that the
  // same way.

  // Through `cancelPledgeRecord` so the write and its audit row land in ONE
  // transaction. The actor is the system, honestly labelled: no human decided
  // this, and a row claiming otherwise would mislead whoever reads it later.
  try {
    await cancelPledgeRecord({
      pid: started.pid,
      actor: { uid: 'system:abandoned-pad-session', mid: null, role: 'family-manager', extraRoles: [] },
    });
  } catch (err) {
    // The repair failed; the pledge is untouched and still blocking. Report that
    // truthfully rather than crashing the page that called us - the family sees
    // the confirming state for another few minutes, and the next visit retries.
    console.error('[pledge] could not clear an abandoned attempt - leaving it in play', err);
    return 'in-play';
  }
  // The letter goes out only on THIS branch - the one call that actually cleared
  // an attempt - so a family browsing three pages after abandoning gets one
  // notice, not three. (`notifyDonationPending`'s cooldown would catch that
  // anyway; not depending on it keeps the two independent.)
  //
  // Awaited, not fire-and-forget: this runs in a serverless function that may be
  // frozen the moment the response is returned, and a floating promise there is
  // a send that silently never happens. `notifyPledgeAbandoned` never throws.
  //
  // Wrapped even though `notifyPledgeAbandoned` owns a try/catch of its own.
  // This function's NEVER-THROWS contract protects page renders, and it must
  // hold structurally rather than by trusting what a neighbouring module
  // currently happens to do - the repair has already succeeded by this line, and
  // an email is never a reason to fail it.
  if (opts.notify !== false) {
    try {
      await notifyPledgeAbandoned({ fid, ...(opts.req ? { req: opts.req } : {}) });
    } catch (err) {
      console.error('[pledge] cleared the abandoned attempt but could not send the notice', err);
    }
  }

  // A lost race - the reconciler or an admin got there first - still means "not
  // in play": whatever they did, this pledge no longer blocks the family.
  // `cancelPledgeRecord` reports that as ok:false, which is not a failure here.
  return 'cleared';
}
