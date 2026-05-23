import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export type InviteRecord = {
  token: string;
  fid: string;
  inviterMid: string;
  inviterName: string;
  familyName: string;
  relation: string;
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByMid: string | null;
};

export type InviteError = { error: 'not-found' | 'expired' | 'accepted' };

export async function getInviteByToken(
  token: string,
): Promise<InviteRecord | InviteError> {
  const db = portalFirestore();

  const snap = await db
    .collectionGroup('invites')
    .where('token', '==', token)
    .limit(1)
    .get();

  if (snap.empty) return { error: 'not-found' };

  const doc = snap.docs[0];
  if (!doc) return { error: 'not-found' };

  const d = doc.data();
  const now = new Date();
  const expiresAt: Date = d['expiresAt']?.toDate ? d['expiresAt'].toDate() : new Date(d['expiresAt']);
  const acceptedAt: Date | null = d['acceptedAt']
    ? (d['acceptedAt']?.toDate ? d['acceptedAt'].toDate() : new Date(d['acceptedAt']))
    : null;

  if (expiresAt <= now) return { error: 'expired' };
  if (acceptedAt !== null) return { error: 'accepted' };

  // fid is the parent family doc id: invites subcollection lives at families/{fid}/invites/{inviteId}
  const fid = doc.ref.parent.parent?.id;
  if (!fid) return { error: 'not-found' };

  return {
    token: d['token'] as string,
    fid,
    inviterMid: d['inviterMid'] as string,
    inviterName: d['inviterName'] as string,
    familyName: d['familyName'] as string,
    relation: d['relation'] as string,
    email: (d['email'] as string).toLowerCase().trim(),
    expiresAt,
    acceptedAt,
    acceptedByMid: d['acceptedByMid'] as string | null ?? null,
  };
}
