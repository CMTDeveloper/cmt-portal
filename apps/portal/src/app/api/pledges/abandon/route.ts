import { NextResponse } from 'next/server';
import { isSetuManager } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getCheckoutSessionSubmission } from '@/features/setu/pledges/stripe-pad-client';
import { findStartedPledge } from '@/features/setu/pledges/find-started-pledge';
import { cancelPledgeRecord } from '@/features/setu/pledges/cancel-pledge';
import { flags } from '@/lib/flags';

/**
 * POST /api/pledges/abandon - clear a monthly plan the family started but never
 * finished authorising, so they can choose again.
 *
 * ── The dead end this exists to end ────────────────────────────────────────
 * Vaibhav, 2026-07-28: *"didn't even complete PAD process. I clicked and backed
 * out from stripe page... currently there is no option for family. It will be
 * all self served."* A hosted session the family walked away from answers
 * `state: "pending"` forever, so `advancePledge` leaves the pledge `started`,
 * and every surface then refuses them: the enroll page shows the confirming
 * card, `/family/donate` says "being set up", and `/api/pledges/start` returns
 * 409 `already-started`. Nothing an admin can do either - the family simply has
 * to start over, and until now nothing let them.
 *
 * ── Why this cannot cause a double mandate ──────────────────────────────────
 * 🔴 The one risk worth naming: if a mandate DOES exist and we clear the record,
 * the family can authorise a second one, and the portal cannot stop either -
 * there is no cancel endpoint, and the temple stops debits by hand in Stripe.
 * So the decision is never taken on our own bookkeeping. We ask the provider,
 * and act only on Stripe's own statement that the session was never submitted
 * (`open`/`expired`). `getCheckoutSessionSubmission` fails CLOSED - anything
 * unrecognised counts as submitted and this route refuses.
 *
 * `fid` comes from the SESSION, never the body, and managers only - the same
 * rule as starting one, because ending an attempt decides who may start the
 * next.
 */
export async function POST(req: Request) {
  // 404 with the feature dark, matching /start: absent rather than forbidden.
  if (!flags.setuPledge) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'no-family' }, { status: 401 });
  if (!isSetuManager(session)) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }

  // Through the pledges feature, never a direct collection read: the isolation
  // invariant holds that this feature is the ONLY reader of `pledges`, and it
  // caught this query the moment it was written here instead.
  const started = await findStartedPledge(session.fid);
  // Nothing in flight - the screen is stale, not broken. The caller reloads.
  if (!started) return NextResponse.json({ error: 'nothing-to-abandon' }, { status: 409 });

  const { setupSessionId } = started;

  // No session id means the provider call never landed when the pledge was
  // created, so nothing can exist at Stripe to double up on. `advancePledge`
  // already treats this as failed for the same reason.
  if (setupSessionId) {
    let submission: Awaited<ReturnType<typeof getCheckoutSessionSubmission>>;
    try {
      submission = await getCheckoutSessionSubmission(setupSessionId);
    } catch {
      // Cannot ask ⇒ cannot rule out a mandate ⇒ do not clear it. Never echo the
      // provider error; it can name customers and payment state.
      return NextResponse.json({ error: 'provider-unavailable' }, { status: 503 });
    }
    if (submission === 'submitted') {
      // A mandate may exist. The reconciler resolves it to active or failed
      // within a day, and only the temple can stop a live debit.
      return NextResponse.json({ error: 'mandate-may-exist' }, { status: 409 });
    }
  }

  // Through `cancelPledgeRecord` so the write and its audit row land in ONE
  // transaction - a family clearing their own attempt is still a change to a
  // money record, and it must be accountable to somebody afterwards.
  const result = await cancelPledgeRecord({
    pid: started.pid,
    actor: {
      uid: session.uid ?? 'unknown',
      mid: session.mid,
      role: session.role,
      extraRoles: session.extraRoles,
    },
  });
  if (!result.ok) {
    // Lost a race with the reconciler or an admin - whatever they did stands.
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true, pid: started.pid }, { status: 200 });
}
