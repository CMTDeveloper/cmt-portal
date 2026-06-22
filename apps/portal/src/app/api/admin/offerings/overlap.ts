import type { Location } from '@cmt/shared-domain';

export const OFFERING_DATE_OVERLAP_ERROR = 'offering-date-overlap';

const OPEN_ENDED = new Date('9999-12-31T23:59:59.999Z');

type FirestoreDoc = {
  id: string;
  data(): Record<string, unknown>;
};

type FirestoreQuery = {
  where(fieldPath: string, opStr: '==', value: unknown): FirestoreQuery;
  get(): Promise<{ docs: FirestoreDoc[] }>;
};

type FirestoreLike = {
  collection(path: string): FirestoreQuery;
};

export type OfferingOverlapCandidate = {
  programKey: string;
  location: Location | null;
  enabled: boolean;
  startDate: Date;
  endDate: Date | null;
};

export type OfferingOverlapConflict = {
  oid: string;
  termLabel?: string;
};

export function timestampValueToDate(value: unknown): Date {
  if (value !== null && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return value instanceof Date ? value : new Date(value as string);
}

function rangesOverlap(
  leftStart: Date,
  leftEnd: Date | null,
  rightStart: Date,
  rightEnd: Date | null,
) {
  return leftStart <= (rightEnd ?? OPEN_ENDED) && (leftEnd ?? OPEN_ENDED) >= rightStart;
}

export async function findOverlappingEnabledOffering(
  db: FirestoreLike,
  candidate: OfferingOverlapCandidate,
  excludeOid?: string,
): Promise<OfferingOverlapConflict | null> {
  if (!candidate.enabled) return null;

  const snap = await db
    .collection('offerings')
    .where('programKey', '==', candidate.programKey)
    .where('location', '==', candidate.location)
    .where('enabled', '==', true)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data();
    const oid = typeof data['oid'] === 'string' ? data['oid'] : doc.id;
    if (excludeOid && (doc.id === excludeOid || oid === excludeOid)) continue;

    const startDate = timestampValueToDate(data['startDate']);
    const endDate = data['endDate'] != null ? timestampValueToDate(data['endDate']) : null;
    if (rangesOverlap(candidate.startDate, candidate.endDate, startDate, endDate)) {
      return {
        oid,
        ...(typeof data['termLabel'] === 'string' ? { termLabel: data['termLabel'] } : {}),
      };
    }
  }

  return null;
}

export function offeringOverlapPayload(
  conflict: OfferingOverlapConflict,
  location: Location | null,
) {
  const locationLabel = location ?? 'location-less';
  const conflictLabel = conflict.termLabel ? ` (${conflict.termLabel})` : '';
  return {
    error: OFFERING_DATE_OVERLAP_ERROR,
    message: `This enabled offering overlaps with an existing ${locationLabel} offering${conflictLabel}. Adjust the dates or disable the existing offering before saving.`,
    conflictOid: conflict.oid,
  };
}
