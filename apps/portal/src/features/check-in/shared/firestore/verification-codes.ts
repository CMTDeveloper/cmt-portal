import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const CODE_TTL_MS = 10 * 60 * 1000;

export function hashContact(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
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

  const data = snap.data() as { code: string; type: string; expiresAt: number } | undefined;
  if (!data) return false;
  if (data.type !== type) return false;
  if (data.expiresAt < Date.now()) return false;
  if (data.code !== code) return false;

  await ref.delete();
  return true;
}
