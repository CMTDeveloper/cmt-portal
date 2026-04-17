import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

export async function checkSevakByEmail(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const sevaks = await readRtdb<Record<string, { email?: string } | null>>('sevaks');
  if (!sevaks) return false;
  for (const key of Object.keys(sevaks)) {
    const entry = sevaks[key];
    if (!entry) continue;
    if (entry.email && entry.email.toLowerCase().trim() === normalizedEmail) {
      return true;
    }
  }
  return false;
}
