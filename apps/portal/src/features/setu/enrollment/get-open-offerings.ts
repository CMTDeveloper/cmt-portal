import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { OfferingDoc, Location } from '@cmt/shared-domain';

export type OpenOffering = OfferingDoc;

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/**
 * Maps a raw Firestore document to an OfferingDoc.
 * endDate is nullable (rolling offerings have no end date).
 */
function docToOffering(data: Record<string, unknown>): OfferingDoc {
  return {
    oid: data['oid'] as string,
    programKey: data['programKey'] as string,
    programLabel: data['programLabel'] as string,
    location: (data['location'] ?? null) as OfferingDoc['location'],
    termLabel: data['termLabel'] as string,
    termType: data['termType'] as OfferingDoc['termType'],
    startDate: toDate(data['startDate']),
    endDate: data['endDate'] != null ? toDate(data['endDate']) : null,
    pricingTiers: (data['pricingTiers'] as OfferingDoc['pricingTiers']) ?? [],
    ...(data['amountTiers'] !== undefined ? { amountTiers: data['amountTiers'] as number[] } : {}),
    ...(data['paymentSource'] !== undefined ? { paymentSource: data['paymentSource'] as OfferingDoc['paymentSource'] } : {}),
    enabled: data['enabled'] as boolean,
    createdAt: toDate(data['createdAt']),
    createdBy: data['createdBy'] as string,
    updatedAt: toDate(data['updatedAt']),
    updatedBy: data['updatedBy'] as string,
  };
}

/**
 * Returns all enabled offerings for (programKey, optional location) whose
 * endDate is null (rolling) or >= now, ordered by startDate ascending.
 *
 * This replaces resolveActivePeriod — it returns ALL open offerings, not just
 * the current one, so the enroll flow can let the family pick.
 *
 * Server-only helper — called from server components and route handlers.
 */
export async function getOpenOfferings(params: {
  programKey: string;
  location?: Location | null;
}): Promise<OpenOffering[]> {
  const now = new Date();
  const db = portalFirestore();

  let q = db
    .collection('offerings')
    .where('programKey', '==', params.programKey)
    .where('enabled', '==', true);

  if (params.location !== undefined) {
    q = q.where('location', '==', params.location);
  }

  const snap = await q.orderBy('startDate', 'asc').get();

  return snap.docs
    .map((d) => docToOffering(d.data() as Record<string, unknown>))
    .filter((o) => o.endDate == null || o.endDate >= now);
}

/**
 * Returns the open offerings a family can enroll in, accounting for both
 * location-bound and location-less (online/virtual) offerings.
 *
 * Firestore can't OR across a single field (`location == X OR location == null`)
 * in one query, so this issues TWO `getOpenOfferings` calls and merges:
 *   (a) offerings at `familyLocation` (only when non-null), and
 *   (b) location-less offerings (`location == null`).
 *
 * Results are deduped by `oid` and sorted by `startDate` ascending. When
 * `familyLocation` is null, only the location-less set is returned.
 *
 * This fixes the bug where a located family querying `location == familyLocation`
 * could never see online programs (spec §8.3 + the G3 acceptance walkthrough).
 */
export async function getOpenOfferingsForFamily(
  programKey: string,
  familyLocation: Location | null,
): Promise<OpenOffering[]> {
  const locationLess = await getOpenOfferings({ programKey, location: null });

  if (familyLocation == null) {
    return locationLess;
  }

  const located = await getOpenOfferings({ programKey, location: familyLocation });

  // Dedupe by oid (located first, then any location-less not already present).
  const byOid = new Map<string, OpenOffering>();
  for (const o of located) byOid.set(o.oid, o);
  for (const o of locationLess) if (!byOid.has(o.oid)) byOid.set(o.oid, o);

  return [...byOid.values()].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}
