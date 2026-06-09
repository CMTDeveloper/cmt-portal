import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { SetMemberGradeBody } from '@cmt/shared-domain';

/** Sets one child's schoolGrade. Returns false if the member doc doesn't exist. */
export async function setMemberGrade({ fid, mid, schoolGrade }: SetMemberGradeBody): Promise<boolean> {
  const ref = portalFirestore().collection('families').doc(fid).collection('members').doc(mid);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update({ schoolGrade });
  return true;
}
