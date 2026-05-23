import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyByContact as legacyFindFamilyByContact } from '@/features/check-in/shared/rtdb/family-lookup';
import { normalizeContact } from '@/features/check-in/shared/contact/normalize';

export interface SetuContactKeyDoc {
  contactKey: string;
  type: 'email' | 'phone';
  fid: string;
  mid: string;
}

export interface FindSetuFamilyResult {
  source: 'setu' | 'legacy' | null;
  fid: string | null;
  mid: string | null;
  legacyFid: string | null;
  family: Record<string, unknown> | null;
  member?: Record<string, unknown>;
}

function hashContact(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

export async function findSetuFamilyByContact(
  type: 'email' | 'phone',
  value: string,
): Promise<FindSetuFamilyResult> {
  const normalized = normalizeContact(type, value);
  const hash = hashContact(normalized);
  const db = portalFirestore();

  const contactKeySnap = await db.collection('contactKeys').doc(hash).get();

  if (contactKeySnap.exists) {
    const data = contactKeySnap.data() as SetuContactKeyDoc;
    const [familySnap, memberSnap] = await Promise.all([
      db.collection('families').doc(data.fid).get(),
      db.collection('families').doc(data.fid).collection('members').doc(data.mid).get(),
    ]);

    const memberData = memberSnap.exists ? (memberSnap.data() as Record<string, unknown>) : null;
    const result: FindSetuFamilyResult = {
      source: 'setu',
      fid: data.fid,
      mid: data.mid,
      legacyFid: null,
      family: familySnap.exists ? (familySnap.data() as Record<string, unknown>) ?? null : null,
    };
    if (memberData !== null) {
      result.member = memberData;
    }
    return result;
  }

  // Legacy fallback — pre-migration families can still sign in
  const legacyFamily = await legacyFindFamilyByContact(type, value);
  if (legacyFamily) {
    return {
      source: 'legacy',
      fid: null,
      mid: null,
      legacyFid: legacyFamily.fid,
      family: legacyFamily as unknown as Record<string, unknown>,
    };
  }

  return { source: null, fid: null, mid: null, legacyFid: null, family: null };
}
