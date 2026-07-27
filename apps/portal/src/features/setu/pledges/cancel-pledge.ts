import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import { writeAuditLog } from '@/features/setu/audit/audit-log';

export interface CancelActor {
  uid: string;
  mid: string | null;
  role: string;
  extraRoles: string[];
}

export type CancelPledgeResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'already-cancelled' | 'not-cancellable' };

/** The temple may stop a pledge that is live, or one that never confirmed. */
const CANCELLABLE: readonly PledgeStatus[] = ['started', 'active'];

/**
 * Mark a pledge cancelled in the portal's records. BOOKKEEPING ONLY.
 *
 * ── 🔴 This does not stop any money ─────────────────────────────────────────
 * The temple cancels the actual debit MANUALLY in Stripe (Vaibhav 2026-07-26).
 * There is no cancel endpoint on the payment service and the portal cannot stop
 * a debit. Deliberately, this module does not even import the PAD client - the
 * absence is the guarantee, and a test asserts no provider call happens.
 *
 * The screen that calls this MUST say so in as many words. Left implicit, staff
 * will click it, believe the money stopped, and the family keeps being charged.
 *
 * ── Why `failed` is refused rather than overwritten ─────────────────────────
 * `failed` is the provider's verdict; `cancelled` is the temple's decision.
 * Relabelling one as the other destroys the only record of which happened, and
 * neither blocks the family from starting a new pledge, so there is nothing to
 * gain by allowing it.
 */
export async function cancelPledgeRecord(args: {
  pid: string;
  actor: CancelActor;
}): Promise<CancelPledgeResult> {
  const db = portalFirestore();
  const ref = db.collection('pledges').doc(args.pid);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { ok: false as const, reason: 'not-found' as const };

    const pledge = snap.data() as { fid?: string; status?: PledgeStatus };
    const status = pledge.status;

    // Idempotent, and quiet about it. A double-click must not write a second
    // audit row naming a second canceller, nor overwrite the original timestamp.
    if (status === 'cancelled') return { ok: false as const, reason: 'already-cancelled' as const };
    if (!status || !CANCELLABLE.includes(status)) {
      return { ok: false as const, reason: 'not-cancellable' as const };
    }

    txn.update(ref, { status: 'cancelled' satisfies PledgeStatus, cancelledAt: new Date() });
    // In the SAME transaction: a committed cancellation can never lack a row,
    // and a rejected one can never leave a stray row behind.
    writeAuditLog(txn, db, {
      actorUid: args.actor.uid,
      actorMid: args.actor.mid,
      actorRole: args.actor.role,
      actorExtraRoles: args.actor.extraRoles,
      action: 'pledge.cancel',
      fid: pledge.fid ?? '',
      mid: null,
      // The prior status, recorded because the row must still make sense to
      // someone reading it long after the pledge document itself has moved on.
      before: { status },
      after: { status: 'cancelled' },
    });
    return { ok: true as const };
  });
}
