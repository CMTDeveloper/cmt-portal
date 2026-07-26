import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue, portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;

/**
 * Where sign-in codes live. The NAME is a security control, not a label.
 *
 * The live prod ruleset on 715b8 allows `create` on `verification_codes/{any}`
 * with **no `request.auth` condition at all**, and its `hasAll(['code',
 * 'expires', 'type'])` check does not forbid additional keys. The document id
 * used here is `sha256(normalizeContact(...))`, and for an email
 * `normalizeContact` is just `trim().toLowerCase()` - so the id is computable
 * by anyone who knows the address, with no secret involved.
 *
 * Put together: anyone holding the public Firebase API key could write
 * `{ code, expires: <Timestamp>, type, expiresAt: <future ms> }` to that path -
 * `expires` to satisfy the rule, `expiresAt` to satisfy `verifyCode` below -
 * and then present that code to /api/setu/auth/verify-code and be handed a
 * session as the victim. Nothing else stops it: `verifyCode` trusts the
 * document's own fields, and the Admin SDK bypasses rules entirely.
 *
 * So the portal deliberately does NOT use `verification_codes`. Everything
 * outside `family-check-ins/**`, `guest-families/**` and `verification_codes/*`
 * is denied to the client SDK by that ruleset, which is exactly what this name
 * buys. Renaming it back, or reusing this collection anywhere a client can
 * reach, reopens a pre-auth account takeover.
 */
const CODES_COLLECTION = 'setu_verification_codes';

export function hashContact(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

function codesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function storeVerificationCode(
  contact: string,
  code: string,
  type: 'email' | 'phone',
): Promise<void> {
  const hash = hashContact(contact);
  const now = Date.now();

  await portalFirestore()
    .collection(CODES_COLLECTION)
    .doc(hash)
    .set({
      code,
      type,
      expiresAt: now + CODE_TTL_MS,
      createdAt: now,
      verifyAttempts: 0,
    });
}

export async function verifyCode(
  contact: string,
  code: string,
  type: 'email' | 'phone',
): Promise<boolean> {
  const hash = hashContact(contact);
  const ref = portalFirestore().collection(CODES_COLLECTION).doc(hash);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const data = snap.data() as {
    code: string;
    type: string;
    expiresAt: number;
    verifyAttempts: number;
  } | undefined;
  if (!data) return false;
  if (data.type !== type) return false;
  if (data.expiresAt < Date.now()) return false;

  if (!codesEqual(data.code, code)) {
    await ref.update({ verifyAttempts: FieldValue.increment(1) });
    const updated = await ref.get();
    const updatedData = updated.data() as { verifyAttempts: number } | undefined;
    if (!updatedData || updatedData.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
      await ref.delete();
    }
    return false;
  }

  await ref.delete();
  return true;
}
