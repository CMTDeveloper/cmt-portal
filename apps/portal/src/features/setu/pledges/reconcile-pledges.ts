import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import { advancePledge, type AdvancePledgeDoc } from './advance-pledge';

/**
 * How long a pledge may sit in `started` before a human should look.
 *
 * A pre-authorized debit mandate settles in days, not minutes, so a few days of
 * `started` is normal. Two weeks is not: by then either the family abandoned the
 * hosted page (harmless, but it blocks them from starting another) or the hosted
 * flow itself is broken for everyone.
 */
export const STALE_AFTER_DAYS = 14;

export interface StalePledge {
  pid: string;
  fid: string | null;
  daysStarted: number;
}

export interface ReconcileResult {
  scanned: number;
  activated: number;
  failed: number;
  /** Still `started` after this pass - normal, the next run tries again. */
  processing: number;
  /** The provider was unreachable for this row. Status untouched. */
  errored: number;
  stale: StalePledge[];
  /**
   * Pledge ids where a subscription was created AFTER the pledge left
   * `started` - i.e. the portal created a recurring debit nobody expected.
   * A human must verify these in Stripe; nothing here can stop a debit.
   */
  unverified: string[];
}

function toDateOrNull(v: unknown): Date | null {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return null;
}

/**
 * Finish what the browser could not.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 * Step 4 (create the subscription) is a SECOND server call, made after the
 * family returns from the Stripe-hosted mandate page. If the browser dies in
 * between - closed tab, dead battery, flaky phone signal - the mandate exists at
 * Stripe, no subscription is ever created, no money moves, and the family
 * believes they are giving monthly. Nothing else in the system notices. This
 * function is the only thing that repairs it.
 *
 * ── Why the query is a single equality ──────────────────────────────────────
 * `where('status','==','started')` alone, which Firestore indexes automatically.
 * The stale report is computed IN MEMORY from that same scan rather than as a
 * second `where` on `startedAt` - which would have required a
 * `pledges(status, startedAt)` composite index that firestore.indexes.json does
 * not declare. Since every row this reports on is a row already scanned, the
 * extra query would buy nothing but an index to deploy and a
 * FAILED_PRECONDITION to discover in production. `started` is a transient state
 * resolved within a day, so the scan is small by construction.
 *
 * ── Sequential, and error-isolated per row ──────────────────────────────────
 * One family's provider error must never cost another family their pass, and a
 * rejected promise in a batch would abort the rest. Each row is caught
 * individually: the error is recorded on that row, its status is left alone, and
 * the run continues. Leaving the status alone matters - folding a provider
 * outage into `failed` would let one bad afternoon at Stripe mark a queue of
 * perfectly good pledges dead.
 */
export async function reconcilePledges(): Promise<ReconcileResult> {
  const db = portalFirestore();
  const snap = await db
    .collection('pledges')
    .where('status', '==', 'started' satisfies PledgeStatus)
    .get();

  const result: ReconcileResult = {
    scanned: snap.docs.length,
    activated: 0,
    failed: 0,
    processing: 0,
    errored: 0,
    stale: [],
    unverified: [],
  };

  const now = Date.now();
  const staleBefore = now - STALE_AFTER_DAYS * 86_400_000;

  for (const doc of snap.docs) {
    const pledge = doc.data() as AdvancePledgeDoc & { startedAt?: unknown };
    const ref = db.collection('pledges').doc(doc.id);

    let outcome: 'active' | 'processing' | 'failed' | 'error';
    try {
      outcome = await advancePledge(db, ref, pledge, doc.id);
    } catch (err) {
      outcome = 'error';
      result.errored++;
      console.error('[pledge] reconcile failed for %s - status left alone', doc.id, err);
      // Best-effort breadcrumb. If even this write fails the run must continue:
      // the point of the loop is that no single row can end it.
      await ref
        .update({ lastError: String(err), lastCheckedAt: new Date() })
        .catch(() => undefined);
    }

    if (outcome === 'active') result.activated++;
    else if (outcome === 'failed') result.failed++;
    else if (outcome === 'processing') result.processing++;

    // Stale only if it is STILL started after this pass. A row this run just
    // activated or failed is resolved, and reporting it would send a human
    // chasing something already fixed.
    if (outcome === 'processing' || outcome === 'error') {
      const startedAt = toDateOrNull(pledge.startedAt);
      // An unknown age is not evidence of staleness.
      if (startedAt && startedAt.getTime() < staleBefore) {
        result.stale.push({
          pid: doc.id,
          fid: pledge.fid ?? null,
          daysStarted: Math.floor((now - startedAt.getTime()) / 86_400_000),
        });
      }
    }
  }

  // ── The unverified-subscription report ─────────────────────────────────────
  // Keyed on the FLAG that `advancePledge` raises, deliberately NOT on
  // `status IN (cancelled, failed) AND subscriptionId != null`. That combination
  // is the NORMAL steady state - `cancel-pledge.ts` does not clear the handle,
  // and a step-5 failure keeps it too - so it would report almost every settled
  // pledge, and a monitor that always fires is one nobody reads.
  //
  // Single-field equality, auto-indexed, no composite index. FAIL-SOFT: this is
  // monitoring, and it must never be able to cost the reconciliation that is the
  // whole point of the run.
  try {
    const flagged = await db.collection('pledges').where('needsStripeVerification', '==', true).get();
    result.unverified = flagged.docs.map((d) => d.id);
    if (result.unverified.length > 0) {
      console.warn(
        '[pledge] %d subscription(s) created after the pledge left started - VERIFY IN STRIPE: %s',
        result.unverified.length,
        result.unverified.join(', '),
      );
    }
  } catch (err) {
    console.error('[pledge] the unverified-subscription report failed - reconciliation was unaffected', err);
  }

  if (result.stale.length > 0) {
    // Surfaced for a human. Only pids and ages - nothing sensitive is stored on
    // a pledge, and nothing sensitive belongs in a log either.
    console.warn(
      '[pledge] %d pledge(s) stuck in started beyond %d days: %s',
      result.stale.length,
      STALE_AFTER_DAYS,
      result.stale.map((s) => `${s.pid}(${s.daysStarted}d)`).join(', '),
    );
  }

  return result;
}
