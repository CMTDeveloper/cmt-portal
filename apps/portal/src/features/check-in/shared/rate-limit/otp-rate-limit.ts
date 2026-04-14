import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  resetAt?: string;
}

export async function checkAndRecordOtpRateLimit(contact: string): Promise<RateLimitResult> {
  const hash = createHash('sha256').update(contact).digest('hex');
  const ref = portalFirestore().collection('otp_rate_limit').doc(hash);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true };
  }

  const data = snap.data() as { count: number; windowStart: number } | undefined;
  if (!data) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true };
  }

  const windowElapsed = now - data.windowStart >= RATE_LIMIT_WINDOW_MS;
  if (windowElapsed) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true };
  }

  if (data.count >= RATE_LIMIT_MAX) {
    const resetAt = new Date(data.windowStart + RATE_LIMIT_WINDOW_MS).toISOString();
    return { allowed: false, resetAt };
  }

  await ref.set({ count: data.count + 1, windowStart: data.windowStart });
  return { allowed: true };
}
