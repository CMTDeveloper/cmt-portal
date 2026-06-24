import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { SevaOpportunityDoc } from '@cmt/shared-domain';

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/**
 * Maps a raw Firestore document to a SevaOpportunityDoc, converting the
 * Timestamp fields (date, createdAt, updatedAt) to native Dates.
 */
function docToOpportunity(data: Record<string, unknown>): SevaOpportunityDoc {
  return {
    oppId: data['oppId'] as string,
    title: data['title'] as string,
    description: (data['description'] as string | undefined) ?? '',
    date: toDate(data['date']),
    location: (data['location'] as string | undefined) ?? '',
    defaultHours: data['defaultHours'] as number,
    capacity: (data['capacity'] as number | null | undefined) ?? null,
    sevaYear: data['sevaYear'] as string,
    status: data['status'] as SevaOpportunityDoc['status'],
    createdAt: toDate(data['createdAt']),
    createdBy: data['createdBy'] as string,
    updatedAt: toDate(data['updatedAt']),
    updatedBy: data['updatedBy'] as string,
  };
}

/**
 * Returns seva opportunities, optionally filtered by sevaYear and/or status,
 * ordered by date ascending. Server-only helper — called from server
 * components and route handlers.
 */
export async function listOpportunities(filters?: {
  sevaYear?: string;
  status?: 'open' | 'closed' | 'draft';
}): Promise<SevaOpportunityDoc[]> {
  let q: FirebaseFirestore.Query = portalFirestore().collection('seva_opportunities');

  if (filters?.sevaYear !== undefined) {
    q = q.where('sevaYear', '==', filters.sevaYear);
  }
  if (filters?.status !== undefined) {
    q = q.where('status', '==', filters.status);
  }

  const snap = await q.orderBy('date', 'asc').get();

  return snap.docs.map((d) => docToOpportunity(d.data() as Record<string, unknown>));
}

/**
 * Returns the opportunity doc for a given oppId, or null if not found.
 */
export async function getOpportunity(oppId: string): Promise<SevaOpportunityDoc | null> {
  const snap = await portalFirestore().collection('seva_opportunities').doc(oppId).get();
  return snap.exists ? docToOpportunity(snap.data() as Record<string, unknown>) : null;
}

/**
 * Serializes a SevaOpportunityDoc for an API response, ISO-stringifying the
 * Date fields so the payload is mobile-consumable (never raw Timestamps/Dates).
 */
export function serializeOpportunity(o: SevaOpportunityDoc) {
  return {
    ...o,
    date: o.date.toISOString(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
