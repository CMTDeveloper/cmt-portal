import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { DonationDoc } from '@cmt/shared-domain';

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

function rawToDonation(data: Record<string, unknown>): DonationDoc {
  return {
    ...(data as Omit<DonationDoc, 'createdAt' | 'updatedAt'>),
    createdAt: toDate(data['createdAt']),
    updatedAt: toDate(data['updatedAt']),
  };
}

/**
 * Returns a family's donations, newest first. Uses the composite index
 * `donations (fid ASC, createdAt DESC)` declared in firestore.indexes.json.
 */
export async function getDonations(fid: string): Promise<DonationDoc[]> {
  const db = portalFirestore();
  const snap = await db
    .collection('donations')
    .where('fid', '==', fid)
    .orderBy('createdAt', 'desc')
    .get();

  if (snap.empty) return [];
  return snap.docs.map((d) => rawToDonation(d.data() as Record<string, unknown>));
}
