import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

export class ContactInUseError extends Error {
  constructor() {
    super('contact-in-use');
    this.name = 'ContactInUseError';
  }
}

export interface AddVerifiedContactArgs {
  fid: string;
  mid: string;
  type: 'email' | 'phone';
  value: string;
}

// Anti-theft: refuse if the contact's hash already maps to a DIFFERENT member
// (any family). Idempotent if it already maps to this member. Orphaned keys
// (exist but have no mid) are claimed/repaired — we hold OTP proof. On success:
// write a source:'self-verified' contactKey → this mid, and append the
// normalized value to the member's altEmails/altPhones (1:1 with the hash).
// All inside one transaction.
export async function addVerifiedContact(args: AddVerifiedContactArgs): Promise<void> {
  const { fid, mid, type, value } = args;
  const db = portalFirestore();
  const hash = hashContactKey(type, value);
  const contactKeyRef = db.collection('contactKeys').doc(hash);
  const memberRef = db.collection('families').doc(fid).collection('members').doc(mid);

  await db.runTransaction(async (txn) => {
    const existing = await txn.get(contactKeyRef);
    if (existing.exists) {
      const data = existing.data() as { mid?: string } | undefined;
      // Member-level (not family-level) anti-theft: a contact bound to a
      // DIFFERENT member — even within the same family — must not be re-bound.
      if (data?.mid && data.mid !== mid) {
        throw new ContactInUseError();
      }
      // Already bound to THIS member → idempotent no-op (arrayUnion would
      // dedupe anyway, but skip the writes).
      if (data?.mid === mid) {
        return;
      }
      // exists but orphaned (no mid): fall through to claim it for this member
      // (we hold a fresh OTP proof of ownership) rather than silently no-op'ing.
    }

    const normalized = normalizeContactForKey(type, value);

    txn.set(contactKeyRef, {
      contactKey: hash,
      type,
      fid,
      mid,
      source: 'self-verified',
      verifiedAt: FieldValue.serverTimestamp(),
    });

    const field = type === 'email' ? 'altEmails' : 'altPhones';
    txn.update(memberRef, { [field]: FieldValue.arrayUnion(normalized) });
  });
}
