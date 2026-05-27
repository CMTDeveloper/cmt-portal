import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import type { DonationPeriodDoc } from '@cmt/shared-domain';
import type { ResolveActivePeriodParams } from '@cmt/shared-domain';

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v as string);
}

function docToPeriod(data: Record<string, unknown>): DonationPeriodDoc {
  return {
    ...(data as Omit<DonationPeriodDoc, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'>),
    startDate: toDate(data['startDate']),
    endDate: toDate(data['endDate']),
    createdAt: toDate(data['createdAt']),
    updatedAt: toDate(data['updatedAt']),
  };
}

/**
 * Returns the most-recently-started active enabled period for (programKey, location)
 * that contains `now`. Returns null if none match.
 *
 * Server-only helper — called from server components and route handlers.
 */
export async function resolveActivePeriod(
  params: ResolveActivePeriodParams,
): Promise<DonationPeriodDoc | null> {
  const { location, programKey } = params;
  const db = portalFirestore();
  const now = new Date();

  const snap = await db
    .collection('donationPeriods')
    .where('programKey', '==', programKey)
    .where('location', '==', location)
    .where('enabled', '==', true)
    .orderBy('startDate', 'desc')
    .get();

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const period = docToPeriod(data);
    if (period.startDate <= now && period.endDate >= now) {
      return period;
    }
  }

  return null;
}
