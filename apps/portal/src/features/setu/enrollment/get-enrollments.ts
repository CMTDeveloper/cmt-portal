import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount } from '@cmt/shared-domain';
import type { EnrollmentDoc, OfferingDoc } from '@cmt/shared-domain';

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

function rawToEnrollment(data: Record<string, unknown>): EnrollmentDoc {
  return {
    ...(data as Omit<EnrollmentDoc, 'enrolledAt' | 'cancelledAt'>),
    enrolledAt: toDate(data['enrolledAt']),
    cancelledAt: data['cancelledAt'] != null ? toDate(data['cancelledAt']) : null,
  };
}

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

export type EnrollmentWithOffering = EnrollmentDoc & {
  effectiveSuggestedAmount: number;
  offering: OfferingDoc | null;
};

/**
 * Returns all enrollments for a family, joined with their offering docs.
 * Sorted by enrolledAt DESC.
 */
export async function getEnrollments(fid: string): Promise<EnrollmentWithOffering[]> {
  const db = portalFirestore();

  const snap = await db
    .collection('families')
    .doc(fid)
    .collection('enrollments')
    .orderBy('enrolledAt', 'desc')
    .get();

  if (snap.empty) return [];

  const enrollments = snap.docs.map((d) => rawToEnrollment(d.data() as Record<string, unknown>));

  const uniqueOids = [...new Set(enrollments.map((e) => e.oid))];
  const offeringDocs = await Promise.all(
    uniqueOids.map((oid) => db.collection('offerings').doc(oid).get()),
  );

  const offeringMap = new Map<string, OfferingDoc>();
  for (const doc of offeringDocs) {
    if (doc.exists) {
      offeringMap.set(doc.id, docToOffering(doc.data() as Record<string, unknown>));
    }
  }

  return enrollments.map((e) => {
    const offering = offeringMap.get(e.oid) ?? null;
    // Suggested amount is recomputed LIVE from the CURRENT offering, resolved at
    // the family's enroll date. This lets an admin's later price correction (or
    // tier edit) reach already-enrolled, unpaid families, while resolving by
    // enrolledAt still honors the pricing tier that applied when they enrolled
    // (early-bird fairness). A per-family override always wins; if the offering
    // doc is gone, fall back to the enroll-time snapshot.
    const effectiveSuggestedAmount =
      e.suggestedAmountOverride ??
      (offering ? resolveSuggestedAmount(offering, e.enrolledAt) : e.suggestedAmountSnapshot);
    return { ...e, effectiveSuggestedAmount, offering };
  });
}
