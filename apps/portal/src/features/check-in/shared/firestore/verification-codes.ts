import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue, portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;

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
    .collection('verification_codes')
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
  const ref = portalFirestore().collection('verification_codes').doc(hash);
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
