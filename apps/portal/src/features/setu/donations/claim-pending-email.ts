import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * How long before the same family may be told AGAIN that their donation is
 * outstanding. Seven days, so a family who abandons checkout and then turns up
 * at the door the following Sunday is nudged once more - but a family clicking
 * back and forth in one sitting is mailed once.
 */
export const PENDING_EMAIL_COOLDOWN_DAYS = 7;

/**
 * Claim the right to send ONE "donation still pending" email for this
 * enrollment, or report that someone already has it.
 *
 * ── Why a claim, and why on the enrollment ──────────────────────────────────
 * Two very different callers send this email - the family bouncing off the
 * Stripe page, and the kiosk recording a check-in for a family who has not paid
 * - and neither knows what the other did. Left ungoverned they compound: the
 * cancel page re-renders on reload, and the kiosk fires every single Sunday, so
 * an unpaid family could accumulate an inbox full of the same letter.
 *
 * The enrollment document is the right home for the stamp because the enrollment
 * IS the thing the email is about, and it is already scoped to one family and
 * one school year. A stamp on the family would outlive the year; a stamp in
 * memory would not survive a lambda.
 *
 * ── Transactional, not read-then-write ──────────────────────────────────────
 * A double-click on the door tablet is two concurrent requests. Both would read
 * "no stamp" and both would send. The transaction makes exactly one win.
 *
 * ── Fails CLOSED ────────────────────────────────────────────────────────────
 * Any error returns false, i.e. DO NOT SEND. The cost of a missed nudge is that
 * a family sees the outstanding donation on their dashboard, which they can
 * already see; the cost of a failed guard is duplicate mail from the temple.
 */
export async function claimPendingEmail(
  fid: string,
  eid: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const ref = portalFirestore()
      .collection('families')
      .doc(fid)
      .collection('enrollments')
      .doc(eid);

    return await portalFirestore().runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return false;

      const raw = (snap.data() as { pendingEmailSentAt?: unknown } | undefined)?.pendingEmailSentAt;
      const last = toDate(raw);
      if (last) {
        const days = (now.getTime() - last.getTime()) / 86_400_000;
        // `days < cooldown` rather than `<=`, and a FUTURE stamp (clock skew,
        // a bad backfill) also blocks: an unreadable or nonsensical stamp must
        // not be treated as permission to mail.
        if (days < PENDING_EMAIL_COOLDOWN_DAYS) return false;
      }

      txn.update(ref, { pendingEmailSentAt: now });
      return true;
    });
  } catch (err) {
    console.error(`[bv-email] could not claim the pending notice for ${fid}/${eid}`, err);
    return false;
  }
}

/** Firestore Timestamp | Date | ISO string -> Date, or null when unreadable. */
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Present but unreadable. Returning null would say "never sent" and re-open
  // the spam door, so hand back a stamp far in the future: the caller's
  // `days < cooldown` check then blocks, which is the fail-closed direction.
  return new Date(8640000000000000);
}
