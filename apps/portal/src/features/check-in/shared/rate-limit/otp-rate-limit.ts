import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const RATE_LIMIT_MAX = 5;
// Read-only family lookup fires several times per registration attempt (debounce
// + email/phone blurs + Continue) and is not a costly OTP send, so it gets a far
// more lenient per-IP bucket than OTP sends — still bounded for anti-enumeration.
export const LOOKUP_RATE_LIMIT_MAX = 30;
// Per-member ceiling on "add a contact" OTP sends (the caller, not the target),
// so an authenticated member can't spray OTPs to many arbitrary contacts.
export const CONTACTS_SEND_PER_SENDER_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  resetAt?: string;
}

export async function checkAndRecordOtpRateLimit(contact: string, max: number = RATE_LIMIT_MAX): Promise<RateLimitResult> {
  const hash = createHash('sha256').update(contact).digest('hex');
  const ref = portalFirestore().collection('otp_rate_limit').doc(hash);

  return portalFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (!snap.exists) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    const data = snap.data() as { count: number; windowStart: number } | undefined;
    if (!data) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    const windowElapsed = now - data.windowStart >= RATE_LIMIT_WINDOW_MS;
    if (windowElapsed) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (data.count >= max) {
      const resetAt = new Date(data.windowStart + RATE_LIMIT_WINDOW_MS).toISOString();
      return { allowed: false, resetAt };
    }

    tx.set(ref, { count: data.count + 1, windowStart: data.windowStart });
    return { allowed: true };
  });
}
