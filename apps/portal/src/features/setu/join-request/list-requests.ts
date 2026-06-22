import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export type JoinRequestListItem = {
  token: string;
  requesterName?: string;
  requesterEmail: string;
  requesterPhone?: string;
  matchedMid: string;
  createdAt: string | null;
  status: 'pending';
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  return new Date(value as string);
}

// List the open (pending) join-requests for a single family, newest first.
// Scoped to families/{fid}/joinRequests so no collectionGroup index is needed
// for the manager panel. createdAt is serialised to an ISO string (or null for
// a doc whose serverTimestamp hasn't materialised yet).
export async function listPendingJoinRequests(
  fid: string,
): Promise<JoinRequestListItem[]> {
  const db = portalFirestore();
  const snap = await db
    .collection('families')
    .doc(fid)
    .collection('joinRequests')
    .where('status', '==', 'pending')
    .get();

  const items: JoinRequestListItem[] = snap.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>;
    const created = toDate(d['createdAt']);
    const requesterName = d['requesterName'] as string | undefined;
    const requesterPhone = d['requesterPhone'] as string | undefined;
    return {
      token: (d['token'] as string) ?? doc.id,
      ...(requesterName ? { requesterName } : {}),
      requesterEmail: (d['requesterEmail'] as string) ?? '',
      ...(requesterPhone ? { requesterPhone } : {}),
      matchedMid: d['matchedMid'] as string,
      createdAt: created ? created.toISOString() : null,
      status: 'pending' as const,
    };
  });

  // Newest first; sort in memory so no composite index is required.
  items.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });

  return items;
}
