import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export type JoinRequestRecord = {
  token: string;
  fid: string;
  matchedMid: string;
  requesterName: string | null;
  requesterEmail: string;
  requesterPhone: string | null;
  familyName: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: Date | null;
  expiresAt: Date;
};

export type JoinRequestError = { error: 'not-found' };

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  return new Date(value as string);
}

// Look up a join-request by its token via a collectionGroup query (mirrors
// get-invite.ts). The fid is the parent family doc id. Resolves the family name
// for the approve page. Does NOT enforce auth or expiry — the route does that
// (and approve enforces fid match); this is a pure read.
export async function getJoinRequestByToken(
  token: string,
): Promise<JoinRequestRecord | JoinRequestError> {
  const db = portalFirestore();

  const snap = await db
    .collectionGroup('joinRequests')
    .where('token', '==', token)
    .limit(1)
    .get();

  if (snap.empty) return { error: 'not-found' };

  const doc = snap.docs[0];
  if (!doc) return { error: 'not-found' };

  const fid = doc.ref.parent.parent?.id;
  if (!fid) return { error: 'not-found' };

  const d = doc.data() as Record<string, unknown>;

  const familySnap = await db.collection('families').doc(fid).get();
  const familyName =
    (familySnap.exists ? (familySnap.data() as { name?: string } | undefined)?.name : undefined) ??
    fid;

  const expiresAt = toDate(d['expiresAt']) ?? new Date(0);

  return {
    token: (d['token'] as string) ?? token,
    fid,
    matchedMid: d['matchedMid'] as string,
    requesterName: (d['requesterName'] as string | undefined) ?? null,
    requesterEmail: (d['requesterEmail'] as string) ?? '',
    requesterPhone: (d['requesterPhone'] as string | undefined) ?? null,
    familyName,
    status: (d['status'] as 'pending' | 'approved' | 'declined') ?? 'pending',
    createdAt: toDate(d['createdAt']),
    expiresAt,
  };
}
