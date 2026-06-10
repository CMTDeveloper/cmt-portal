import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

/**
 * Member-id-keyed role assignments. Decouples "is this person an admin?"
 * from "which Firebase auth user signed in?" — a Bala Vihar family member
 * has separate auth uids for their email and phone, but ONE mid. By keying
 * roles on mid, we grant admin once and the claim applies regardless of
 * which contact the person uses for OTP sign-in.
 *
 * Doc shape (Firestore collection: `roleAssignments`):
 *   {
 *     mid: "CMT-P672RGSS-01",
 *     fid: "CMT-P672RGSS",
 *     roles: ["admin", "welcome-team"],
 *     grantedAt: <timestamp>,
 *     grantedVia: "dineshdm7@gmail.com"    // input contact at grant time
 *   }
 *
 * Non-family CMT sevaks (admins without a Bala Vihar family) still use the
 * legacy auth-claim path — that's handled separately in verify-code.
 */

export type GrantableRole = 'admin' | 'welcome-team';

const COLLECTION = 'roleAssignments';

interface RoleAssignmentDoc {
  mid: string;
  fid: string;
  roles?: GrantableRole[];
  grantedAt?: FirebaseFirestore.Timestamp;
  grantedVia?: string | null;
}

export async function getMemberRoles(mid: string): Promise<GrantableRole[]> {
  const snap = await portalFirestore().collection(COLLECTION).doc(mid).get();
  if (!snap.exists) return [];
  const data = snap.data() as RoleAssignmentDoc | undefined;
  return (data?.roles ?? []).filter(
    (r): r is GrantableRole => r === 'admin' || r === 'welcome-team',
  );
}

export async function addMemberRole(args: {
  mid: string;
  fid: string;
  role: GrantableRole;
  grantedVia?: string;
}): Promise<void> {
  await portalFirestore()
    .collection(COLLECTION)
    .doc(args.mid)
    .set(
      {
        mid: args.mid,
        fid: args.fid,
        roles: FieldValue.arrayUnion(args.role),
        grantedAt: FieldValue.serverTimestamp(),
        grantedVia: args.grantedVia ?? null,
      },
      { merge: true },
    );
}

export async function removeMemberRole(mid: string, role: GrantableRole): Promise<void> {
  await portalFirestore()
    .collection(COLLECTION)
    .doc(mid)
    .set({ roles: FieldValue.arrayRemove(role) }, { merge: true });
}

export async function listMembersWithRole(
  role: GrantableRole,
): Promise<Array<{ mid: string; fid: string; grantedVia: string | null }>> {
  const snap = await portalFirestore()
    .collection(COLLECTION)
    .where('roles', 'array-contains', role)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as RoleAssignmentDoc;
    return {
      mid: data.mid,
      fid: data.fid,
      grantedVia: typeof data.grantedVia === 'string' ? data.grantedVia : null,
    };
  });
}
