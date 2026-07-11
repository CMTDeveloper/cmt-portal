import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { Location } from '@cmt/shared-domain';

export type ResolvedKioskFamily = {
  fid: string; // CMT- doc id (join key)
  location: Location | null;
  publicFid: string | null;
  legacyFid: string | null;
  name: string;
  matchedOn: 'publicFid' | 'legacyFid';
};

/**
 * Resolve a Setu family from the number a family/sevak enters at the kiosk.
 * Tries the new publicFid first (the id we want families to adopt), then the
 * legacy check-in id. publicFid is not DB-unique - limit(1), first hit wins.
 */
export async function resolveKioskFamily(id: string): Promise<ResolvedKioskFamily | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const families = portalFirestore().collection('families');

  const byPublic = await families.where('publicFid', '==', trimmed).limit(1).get();
  const publicDoc = byPublic.docs[0];
  const doc = publicDoc ?? (await families.where('legacyFid', '==', trimmed).limit(1).get()).docs[0];
  if (!doc) return null;

  const data = doc.data() as Record<string, unknown>;
  return {
    fid: doc.id,
    location: (typeof data.location === 'string' ? data.location : null) as Location | null,
    publicFid: typeof data.publicFid === 'string' ? data.publicFid : null,
    legacyFid: typeof data.legacyFid === 'string' ? data.legacyFid : null,
    name: typeof data.name === 'string' && data.name ? data.name : doc.id,
    matchedOn: publicDoc ? 'publicFid' : 'legacyFid',
  };
}
