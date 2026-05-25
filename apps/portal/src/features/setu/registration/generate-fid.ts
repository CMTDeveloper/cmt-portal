import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RANDOM_LENGTH = 8;
export const FID_PREFIX = 'CMT-';

/**
 * Generates a fresh family ID with the `CMT-` prefix.
 *
 * Format: `CMT-XXXXXXXX` where XXXXXXXX is 8 cryptographically random
 * characters drawn from [A-Z0-9]. 12 chars total, 36^8 ≈ 2.8 trillion
 * combinations — collision-free for the foreseeable future of CMT.
 *
 * Member IDs are derived as `${fid}-${zeroPad(n)}`, so a manager looks like
 *   `CMT-A1B2C3D4-01`
 *
 * The CMT- prefix is intentional — it makes FIDs visually distinguishable
 * from random Firestore-generated IDs in admin tooling, logs, and the URL
 * bar (e.g. /welcome/family/CMT-A1B2C3D4).
 */
export function generateFid(): string {
  const bytes = randomBytes(RANDOM_LENGTH);
  let result = FID_PREFIX;
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    const b = bytes[i] ?? 0;
    result += ALPHABET[b % ALPHABET.length];
  }
  return result;
}

/**
 * True if the string looks like a fresh CMT- FID (CMT- + 8 [A-Z0-9]).
 * Does NOT match legacy pre-CMT FIDs (12 [A-Z0-9] without the prefix).
 */
export function isCmtFid(fid: string): boolean {
  return /^CMT-[A-Z0-9]{8}$/.test(fid);
}
