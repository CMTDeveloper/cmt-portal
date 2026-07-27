import 'server-only';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';

/**
 * The ONE place a pledge becomes `active`, and the one place the activation
 * email is sent.
 *
 * ── Why this has to be a transaction ────────────────────────────────────────
 * TWO independent code paths can observe the same `started → active` transition:
 * the family returning from the hosted page (`finalizePledge`) and the daily
 * reconciler cron. A family who returns just as the cron runs is not a
 * hypothetical - the cron processes every `started` pledge, and "just came back"
 * is exactly the state those rows are in.
 *
 * Read-then-write in two places is not idempotent however carefully each side
 * checks: both can read `started`, both can write `active`, and both can send
 * "your monthly gift is set up". A duplicate email about someone's money is a
 * real support call. So activation is a CLAIM: the transaction flips the status
 * only if it is not already `active`, and only the caller that won the claim
 * sends the mail.
 *
 * The email is sent OUTSIDE the transaction on purpose - a mail failure must
 * never roll back an activation that really happened at the provider.
 */
export async function claimPledgeActivation(db: FirebaseFirestore.Firestore, pid: string): Promise<boolean> {
  const ref = db.collection('pledges').doc(pid);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return false;
    const status = (snap.data() as { status?: PledgeStatus }).status;
    // ONLY a `started` pledge may become active. This single check carries three
    // distinct guarantees, which is why there is no separate `=== 'active'`
    // branch above it (there was; it was unreachable, and a mutation run proved
    // it by deleting it with no test noticing):
    //   - `active`    → someone else already won the claim. Not an error, just
    //                   not ours to announce, so no second email goes out.
    //   - `cancelled` → the temple stopped this pledge. A late finalize or a
    //                   cron pass must NEVER put it back.
    //   - `failed`    → terminal at the provider; the family starts a new one.
    if (status !== 'started') return false;
    txn.update(ref, { status: 'active' satisfies PledgeStatus, activatedAt: new Date() });
    return true;
  });
}

/**
 * Claim the activation and, only if this caller won it, tell the family.
 *
 * Returns whether THIS call activated the pledge, so the caller can report a
 * transition rather than a state.
 */
export async function activatePledgeAndNotify(
  db: FirebaseFirestore.Firestore,
  args: { pid: string; toEmail: string | null; monthlyAmountCAD: number },
): Promise<boolean> {
  const won = await claimPledgeActivation(db, args.pid);
  if (!won) return false;

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
  return true;
}
