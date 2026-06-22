import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

export type ApproveResult =
  | { ok: true; matchedMid: string }
  | {
      error:
        | 'not-found'
        | 'fid-mismatch'
        | 'expired'
        | 'already-resolved'
        | 'member-not-found'
        | 'contact-conflict';
    };

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  return new Date(value as string);
}

// Approve a join-request: atomically promote the EXISTING matched member to
// co-manager (manager:true, arrayUnion into family.managers, portalAccess:
// 'active'), ensure the member's contactKey (with the same theft check as
// invite/accept), and mark the request 'approved'. Does NOT mint a session —
// the requester signs in later via OTP. Enforces claims.fid === request.fid:
// the caller MUST pass their own claims fid as `managerFid`.
export async function approveJoinRequest(params: {
  token: string;
  managerFid: string;
}): Promise<ApproveResult> {
  const { token, managerFid } = params;
  const db = portalFirestore();

  try {
    return await db.runTransaction(async (txn) => {
      // --- READS FIRST ---

      // 1. Find the request by token via collectionGroup.
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
      // Manager may only approve a request belonging to their own family.
      if (fid !== managerFid) throw new Error('fid-mismatch');

      // 2. Read the request doc inside the txn for consistency.
      const reqSnap = await txn.get(reqDocRef);
      if (!reqSnap.exists) throw new Error('not-found');
      const reqData = reqSnap.data() as {
        matchedMid?: string;
        status?: string;
        requesterEmail?: string;
        requesterPhone?: string;
        expiresAt?: unknown;
      };
      const matchedMid = reqData.matchedMid;
      if (!matchedMid) throw new Error('not-found');
      if (reqData.status !== 'pending') throw new Error('already-resolved');

      const expiresAt = toDate(reqData.expiresAt);
      if (expiresAt && expiresAt <= new Date()) throw new Error('expired');

      // 3. Read the member being promoted.
      const familyRef = db.collection('families').doc(fid);
      const memberRef = familyRef.collection('members').doc(matchedMid);
      const memberSnap = await txn.get(memberRef);
      if (!memberSnap.exists) throw new Error('member-not-found');
      const member = memberSnap.data() as {
        email?: string | null;
        phone?: string | null;
      };

      // 4. Determine the member's contactKey (prefer the requester's matched
      //    contact, falling back to the member's own on-file contact) and run
      //    the same theft check as invite/accept.
      const reqEmail = (reqData.requesterEmail ?? '').trim();
      const reqPhone = (reqData.requesterPhone ?? '').trim();
      let contactType: 'email' | 'phone' | null = null;
      let contactValue: string | null = null;
      if (reqEmail) {
        contactType = 'email';
        contactValue = reqEmail;
      } else if (reqPhone) {
        contactType = 'phone';
        contactValue = reqPhone;
      } else if (member.email) {
        contactType = 'email';
        contactValue = member.email;
      } else if (member.phone) {
        contactType = 'phone';
        contactValue = member.phone;
      }

      let contactKeyRef: FirebaseFirestore.DocumentReference | null = null;
      let contactHash: string | null = null;
      if (contactType && contactValue) {
        contactHash = hashContactKey(contactType, contactValue);
        contactKeyRef = db.collection('contactKeys').doc(contactHash);
        const contactKeySnap = await txn.get(contactKeyRef);
        if (contactKeySnap.exists) {
          const existing = contactKeySnap.data() as { fid?: string } | undefined;
          if (existing?.fid && existing.fid !== fid) {
            throw new Error('contact-conflict');
          }
        }
      }

      // --- WRITES ---

      // Promote the existing member to co-manager.
      txn.update(memberRef, {
        manager: true,
        portalAccess: 'active',
      });

      // Add to family.managers.
      txn.update(familyRef, {
        managers: FieldValue.arrayUnion(matchedMid),
      });

      // Ensure the contactKey points at this member (idempotent; the theft
      // check above guarantees we never clobber another family's key).
      if (contactKeyRef && contactHash && contactType) {
        txn.set(contactKeyRef, {
          contactKey: contactHash,
          type: contactType,
          fid,
          mid: matchedMid,
        });
      }

      // Mark the request approved.
      txn.update(reqDocRef, {
        status: 'approved',
        resolvedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const, matchedMid };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg === 'not-found' ||
      msg === 'fid-mismatch' ||
      msg === 'expired' ||
      msg === 'already-resolved' ||
      msg === 'member-not-found' ||
      msg === 'contact-conflict'
    ) {
      return { error: msg };
    }
    throw err;
  }
}
