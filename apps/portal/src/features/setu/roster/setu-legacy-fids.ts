import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** All non-null legacyFid values present in the Setu families collection. */
export async function listSetuLegacyFids(): Promise<Set<string>> {
  const snap = await portalFirestore().collection('families').select('legacyFid').get();
  const out = new Set<string>();
  for (const d of snap.docs) {
    const lf = (d.data() as { legacyFid?: unknown }).legacyFid;
    if (typeof lf === 'string' && lf) out.add(lf);
  }
  return out;
}
