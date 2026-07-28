import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';

/**
 * The fids of every family with a LIVE monthly pledge.
 *
 * Since 2026-07-27 the monthly pledge IS the Bala Vihar enrollment donation,
 * paid a month at a time (Vaibhav: *"this is an enrollment option one-time vs
 * monthly"*). So the staff surfaces that report who has paid - the teacher
 * roster, the welcome roster, the reports - all have to know. This is the one
 * read they share.
 *
 * ── ONE QUERY, NEVER A PER-FAMILY FAN-OUT ───────────────────────────────────
 * The welcome roster renders ~870 families. A `pledges` lookup per row would be
 * ~870 round trips and would time out, exactly as the per-family loops did
 * before the bulk-collectionGroup rule. `pledges` is a top-level collection
 * carrying `fid`, so one equality query returns every live pledge and the
 * callers join in memory.
 *
 * **No composite index needed** - single-field equality on `status`, which
 * Firestore indexes automatically. (`reconcile-pledges.ts` already relies on the
 * same shape for `status == 'started'`.)
 *
 * ── `active` ONLY ───────────────────────────────────────────────────────────
 * Deliberately not `isPledgeGiving`-by-hand at each call site: `started` means
 * the family was sent to Stripe and nothing came back - no mandate, no money.
 * Counting it would tell a teacher a family had paid because they once clicked
 * a button. `cancelled` and `failed` are likewise not paying.
 *
 * ── Dark means dark ─────────────────────────────────────────────────────────
 * With the flag off this returns an empty set WITHOUT querying, so every
 * downstream surface behaves exactly as it did before the feature existed.
 */
export async function loadActivePledgeFids(): Promise<ReadonlySet<string>> {
  if (!flags.setuPledge) return new Set();

  try {
    const snap = await portalFirestore().collection('pledges').where('status', '==', 'active').get();
    const fids = new Set<string>();
    for (const doc of snap.docs) {
      const fid = (doc.data() as { fid?: unknown }).fid;
      if (typeof fid === 'string' && fid) fids.add(fid);
    }
    return fids;
  } catch (err) {
    // FAIL-SOFT, and in the safe direction. A roster that renders with every
    // family reading "outstanding" is a bad afternoon; a roster that 500s is a
    // teacher who cannot take attendance. Under-reporting a pledge is also the
    // recoverable error: staff can look the family up, whereas wrongly showing
    // "paid" would have them stop asking.
    console.error('[pledges] active-pledge lookup failed - treating every family as un-pledged', err);
    return new Set();
  }
}
