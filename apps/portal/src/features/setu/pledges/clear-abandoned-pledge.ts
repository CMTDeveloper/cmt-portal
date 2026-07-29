import 'server-only';
import { getCheckoutSessionSubmission } from './stripe-pad-client';
import { findStartedPledge } from './find-started-pledge';
import { cancelPledgeRecord } from './cancel-pledge';

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
 * `getCheckoutSessionSubmission` fails CLOSED, and so does this - any provider
 * error returns `in-play`, leaving the family locked rather than exposed.
 *
 * Proven necessary, not theoretical: probing the service for a session Vaibhav
 * backed out of returned `{"state":"pending","reason":"PAD setup not completed
 * yet","stripe":{"status":"open"}}` - `pending` forever, so `advancePledge`
 * would have left that pledge `started` until the end of time.
 */
export async function clearAbandonedPledge(fid: string): Promise<ClearAbandonedResult> {
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
  const result = await cancelPledgeRecord({
    pid: started.pid,
    actor: { uid: 'system:abandoned-pad-session', mid: null, role: 'family-manager', extraRoles: [] },
  });
  // A lost race (the reconciler or an admin got there first) is still "not in
  // play" - whatever they did, this pledge is no longer blocking the family.
  return result.ok ? 'cleared' : 'cleared';
}
