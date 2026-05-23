import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import type { FamilySearchHit } from './types';

export type { FamilySearchHit };

const PHONE_DIGIT_RE = /\d/g;
const EMAIL_RE = /@/;

function looksLikePhone(q: string): boolean {
  const digits = (q.match(PHONE_DIGIT_RE) ?? []).length;
  return digits >= 7;
}

function looksLikeEmail(q: string): boolean {
  return EMAIL_RE.test(q);
}

type RawFamilyData = Record<string, unknown>;

function toHit(fid: string, data: RawFamilyData): Omit<FamilySearchHit, 'memberCount'> {
  return {
    fid,
    legacyFid: typeof data.legacyFid === 'string' ? data.legacyFid : null,
    name: typeof data.name === 'string' && data.name ? data.name : fid,
    location:
      typeof data.location === 'string' && data.location ? data.location : 'Brampton',
  };
}

export async function searchFamilies(q: string): Promise<FamilySearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];

  const db = portalFirestore();
  const familiesCol = db.collection('families');

  // Determine search mode
  const isEmail = looksLikeEmail(trimmed);
  const isPhone = !isEmail && looksLikePhone(trimmed);
  const isContactQuery = isEmail || isPhone;

  // Collect raw hits: fid → data (dedup map)
  const rawHits = new Map<string, RawFamilyData>();

  if (isContactQuery) {
    // Only contact-key path
    const type = isEmail ? 'email' : 'phone';
    const hash = hashContactKey(type, trimmed);
    const ckSnap = await db.collection('contactKeys').doc(hash).get();
    if (ckSnap.exists) {
      const ck = ckSnap.data() as { fid: string };
      const famSnap = await familiesCol.doc(ck.fid).get();
      if (famSnap.exists) {
        rawHits.set(ck.fid, famSnap.data() as RawFamilyData);
      }
    }
  } else {
    // Run direct fid, legacyFid, and searchKeys lookups in parallel
    const [fidSnap, legacySnap, nameSnap] = await Promise.all([
      familiesCol.doc(trimmed).get(),
      familiesCol.where('legacyFid', '==', trimmed).limit(1).get(),
      familiesCol.where('searchKeys', 'array-contains', trimmed.toLowerCase()).limit(20).get(),
    ]);

    if (fidSnap.exists) {
      rawHits.set(trimmed, fidSnap.data() as RawFamilyData);
    }

    for (const doc of legacySnap.docs) {
      if (!rawHits.has(doc.id)) {
        rawHits.set(doc.id, doc.data() as RawFamilyData);
      }
    }

    for (const doc of nameSnap.docs) {
      if (!rawHits.has(doc.id)) {
        rawHits.set(doc.id, doc.data() as RawFamilyData);
      }
    }
  }

  if (rawHits.size === 0) return [];

  // Cap at 20 before fetching member counts
  const topFids = Array.from(rawHits.keys()).slice(0, 20);

  // Fetch member counts in parallel
  const memberCounts = await Promise.all(
    topFids.map((fid) =>
      familiesCol
        .doc(fid)
        .collection('members')
        .limit(100)
        .get()
        .then((snap) => snap.docs.length),
    ),
  );

  return topFids.map((fid, i) => ({
    ...toHit(fid, rawHits.get(fid)!),
    memberCount: memberCounts[i] ?? 0,
  }));
}
