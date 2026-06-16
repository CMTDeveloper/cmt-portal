import 'server-only';
import { randomBytes } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

// A registration grant proves that the email used to create a family was just
// OTP-verified. verify-code issues one on the email-with-no-family path;
// /api/setu/register REQUIRES and consumes it. Without this gate, registration
// was unauthenticated — anyone could create a family and receive a
// family-manager session bound to an email they don't own (account squatting).
//
// Properties: random opaque token, bound to the verified email's contact hash,
// short-lived (20 min), single-use (consumed in a transaction). The token never
// reveals the contact; only a caller who received the OTP code for that email
// could have obtained it.

const GRANT_TTL_MS = 20 * 60 * 1000;
const COLLECTION = 'registrationGrants';

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/** Issue a one-time grant for a freshly OTP-verified email. Returns the token. */
export async function issueRegistrationGrant(email: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await portalFirestore().collection(COLLECTION).doc(token).set({
    contactHash: hashContactKey('email', email),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + GRANT_TTL_MS),
  });
  return token;
}

/**
 * Validate + consume a grant for the given email, atomically. Returns true only
 * if the token exists, is unexpired, and was issued for THIS email. The token is
 * deleted on any terminal outcome (success or expiry) so it can't be replayed.
 * A contact-mismatch leaves the token intact (it isn't this caller's to burn).
 */
export async function consumeRegistrationGrant(token: string, email: string): Promise<boolean> {
  const db = portalFirestore();
  const ref = db.collection(COLLECTION).doc(token);
  const expectedHash = hashContactKey('email', email);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return false;
    const d = snap.data() as { contactHash?: string; expiresAt?: unknown };
    if (toDate(d.expiresAt).getTime() <= Date.now()) {
      txn.delete(ref);
      return false;
    }
    if (d.contactHash !== expectedHash) {
      // Wrong email for this grant — do NOT consume (not this caller's token).
      return false;
    }
    txn.delete(ref);
    return true;
  });
}
