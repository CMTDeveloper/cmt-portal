import { randomUUID } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

interface AwardArgs {
  fid: string;
  mid: string;
  title: string;
  description: string | null;
  programKey: string | null;
  awardedByUid: string;
  awardedByName: string | null;
}

function achievementsRef(fid: string, mid: string) {
  return portalFirestore()
    .collection('families').doc(fid)
    .collection('members').doc(mid)
    .collection('achievements');
}

export async function awardAchievement(args: AwardArgs): Promise<{ achId: string }> {
  const achId = randomUUID();
  await achievementsRef(args.fid, args.mid).doc(achId).set({
    achId,
    mid: args.mid,
    fid: args.fid,
    title: args.title,
    description: args.description,
    programKey: args.programKey,
    awardedByUid: args.awardedByUid,
    awardedByName: args.awardedByName,
    awardedAt: FieldValue.serverTimestamp(),
  });
  return { achId };
}

export async function revokeAchievement(fid: string, mid: string, achId: string): Promise<boolean> {
  const ref = achievementsRef(fid, mid).doc(achId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}
