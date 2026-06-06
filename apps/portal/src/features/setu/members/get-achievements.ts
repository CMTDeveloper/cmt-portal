import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** Serialized (plain-JSON) achievement for the child profile + teacher view. */
export interface ChildAchievement {
  achId: string;
  title: string;
  description: string | null;
  programKey: string | null;
  awardedByName: string | null;
  awardedAt: string; // ISO
}

/**
 * Read a member's achievements (newest first). Plain async (NOT 'use cache')
 * so an award/revoke reflects on the next render. Single-field orderBy on the
 * achievements subcollection — no composite index required.
 */
export async function getMemberAchievements(fid: string, mid: string): Promise<ChildAchievement[]> {
  const snap = await portalFirestore()
    .collection('families').doc(fid)
    .collection('members').doc(mid)
    .collection('achievements')
    .orderBy('awardedAt', 'desc')
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      achId: x.achId,
      title: x.title,
      description: x.description ?? null,
      programKey: x.programKey ?? null,
      awardedByName: x.awardedByName ?? null,
      awardedAt: x.awardedAt?.toDate ? x.awardedAt.toDate().toISOString() : new Date(0).toISOString(),
    };
  });
}
