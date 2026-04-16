import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const DEFAULT_MAX = 5;
const WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
}

export async function checkIpRateLimit(
  ip: string,
  maxPerMinute?: number,
): Promise<RateLimitResult> {
  const max = maxPerMinute ?? DEFAULT_MAX;
  const ref = portalFirestore().collection('event_rate_limit').doc(ip);

  return portalFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (!snap.exists) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    const data = snap.data() as
      | { count: number; windowStart: number }
      | undefined;
    if (!data) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (now - data.windowStart >= WINDOW_MS) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (data.count >= max) {
      return { allowed: false };
    }

    tx.set(ref, { count: data.count + 1, windowStart: data.windowStart });
    return { allowed: true };
  });
}
