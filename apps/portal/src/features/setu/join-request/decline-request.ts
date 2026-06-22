import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

export type DeclineResult =
  | { ok: true }
  | { error: 'not-found' | 'fid-mismatch' | 'already-resolved' };

// Decline a join-request: mark it 'declined'. Manager-only + fid match — the
// caller MUST pass their own claims fid as `managerFid`. No member changes.
export async function declineJoinRequest(params: {
  token: string;
  managerFid: string;
}): Promise<DeclineResult> {
  const { token, managerFid } = params;
  const db = portalFirestore();

  try {
    return await db.runTransaction(async (txn) => {
      const reqQuery = await db
        .collectionGroup('joinRequests')
        .where('token', '==', token)
        .limit(1)
        .get();
      if (reqQuery.empty) throw new Error('not-found');
      const reqDocRef = reqQuery.docs[0]?.ref;
      if (!reqDocRef) throw new Error('not-found');

      const fid = reqDocRef.parent.parent?.id;
      if (!fid) throw new Error('not-found');
      if (fid !== managerFid) throw new Error('fid-mismatch');

      const reqSnap = await txn.get(reqDocRef);
      if (!reqSnap.exists) throw new Error('not-found');
      const reqData = reqSnap.data() as { status?: string };
      if (reqData.status !== 'pending') throw new Error('already-resolved');

      txn.update(reqDocRef, {
        status: 'declined',
        resolvedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'not-found' || msg === 'fid-mismatch' || msg === 'already-resolved') {
      return { error: msg };
    }
    throw err;
  }
}
