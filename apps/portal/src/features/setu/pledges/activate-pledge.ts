import 'server-only';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';

/** A terminal status a pledge may be moved to by one pass of the state machine. */
export type SettledStatus = Extract<PledgeStatus, 'active' | 'failed'>;

export interface ClaimResult {
  /** Whether THIS caller performed the transition. */
  won: boolean;
  /** The pledge's status after the transaction - what is now true, won or lost. */
  status: PledgeStatus | null;
}

/**
 * The ONE way a pledge's status is settled, and the one place the activation
 * email is sent.
 *
 * ── Why every status write has to be a compare-and-swap ─────────────────────
 * TWO independent code paths drive the same pledge: the family returning from
 * the hosted page (`finalizePledge`) and the daily reconciler cron. Both load
 * the document, then ask the provider, then write. A race is not exotic here -
 * it is the ordinary shape of the system, and a double-click produces it too.
 *
 * Read-then-write in two places is not idempotent however carefully each side
 * checks: both read `started`, both write, and the LATER answer wins on a
 * document the earlier one already settled. That is not a display bug. A
 * committed `active` overwritten by a late `failed` leaves Stripe debiting the
 * family monthly while the portal shows the ask - and because `failed` does NOT
 * block a new pledge (`start-pledge.ts` LIVE_STATUSES, deliberately, so one bad
 * attempt cannot lock a family out), the family is then offered a SECOND
 * monthly mandate on the same bank account.
 *
 * So the transition is a CLAIM: only a pledge still `started` may be settled,
 * and only the caller that won it may announce anything. The three guarantees
 * that single check carries:
 *   - `active`    → someone else already settled it. Not an error; not ours to
 *                   announce, so no second email and no contradicting write.
 *   - `cancelled` → the temple stopped this pledge. A late finalize or cron pass
 *                   must NEVER relabel it - `cancelled` is the temple's decision
 *                   and `failed` is the provider's verdict, and overwriting one
 *                   with the other destroys the record of which happened (and
 *                   contradicts the `audit_log` row written with it).
 *   - `failed`    → terminal at the provider; a late `success` must not
 *                   resurrect it.
 *
 * Returns what is TRUE after the transaction, not merely whether we won, so a
 * caller can report the real state instead of assuming its own answer stuck. A
 * boolean alone is what let `advancePledge` return `active` for a pledge that
 * had just been written `failed` by someone else.
 */
export async function claimPledgeTransition(
  db: FirebaseFirestore.Firestore,
  pid: string,
  to: SettledStatus,
  extra: Record<string, unknown> = {},
): Promise<ClaimResult> {
  const ref = db.collection('pledges').doc(pid);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { won: false, status: null };
    const status = (snap.data() as { status?: PledgeStatus }).status ?? null;
    if (status !== 'started') return { won: false, status };
    txn.update(ref, { ...extra, status: to });
    return { won: true, status: to };
  });
}

/**
 * Claim the activation and, only if this caller won it, tell the family.
 *
 * The email is sent OUTSIDE the transaction on purpose - a mail failure must
 * never roll back an activation that really happened at the provider.
 */
export async function activatePledgeAndNotify(
  db: FirebaseFirestore.Firestore,
  args: { pid: string; toEmail: string | null; monthlyAmountCAD: number },
): Promise<ClaimResult> {
  const claim = await claimPledgeTransition(db, args.pid, 'active', { activatedAt: new Date() });
  if (!claim.won) return claim;

  if (args.toEmail) {
    try {
      await sendManagedEmail({
        name: 'pledge-activated',
        to: args.toEmail,
        data: { amount: String(args.monthlyAmountCAD) },
        fallback: async () => {
          // No SES template configured (the flag-off / pre-launch state). The
          // activation itself already succeeded; say so in the log and move on
          // rather than throwing and making the caller think it did not.
          console.info('[pledge] activated %s - no activation template configured', args.pid);
        },
      });
    } catch (err) {
      // The debit is live and the record says so. A mail failure must not undo
      // that, and must not make the route report a failure to the family.
      console.error('[pledge] activation email failed for %s', args.pid, err);
    }
  }
  return claim;
}
