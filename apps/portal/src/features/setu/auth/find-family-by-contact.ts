import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyByContact as legacyFindFamilyByContact } from '@/features/check-in/shared/rtdb/family-lookup';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

export interface SetuContactKeyDoc {
  contactKey: string;
  type: 'email' | 'phone';
  fid: string;
  mid: string;
  // Audit/security on newer writes. Absent on registration-era + pre-Phase-B
  // docs (read with safe defaults). 'self-verified' contacts carry verifiedAt.
  source?: 'registration' | 'self-verified';
  verifiedAt?: Date | null;
}

export interface FindSetuFamilyResult {
  source: 'setu' | 'legacy' | null;
  fid: string | null;
  mid: string | null;
  legacyFid: string | null;
  family: Record<string, unknown> | null;
  member?: Record<string, unknown>;
}

export async function findSetuFamilyByContact(
  type: 'email' | 'phone',
  value: string,
): Promise<FindSetuFamilyResult> {
  // CRITICAL: must use the same hashContactKey() function that every writer
  // (register-family, lazy-migrate, accept-invite, members CRUD) uses, OR the
  // doc written with type-prefixed hash will never be found by an
  // unprefixed-hash lookup. The mismatched hash was a pre-existing bug
  // surfaced when lazy-migration first wrote a Setu family for a legacy user
  // in UAT — the post-migration re-lookup missed and the user was redirected
  // to /register?contact=verified instead of /family.
  const hash = hashContactKey(type, value);
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
