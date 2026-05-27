import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { EnrollmentDoc, DonationPeriodDoc } from '@cmt/shared-domain';

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

function rawToPeriod(data: Record<string, unknown>): DonationPeriodDoc {
  return {
    ...(data as Omit<DonationPeriodDoc, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'>),
    startDate: toDate(data['startDate']),
    endDate: toDate(data['endDate']),
    createdAt: toDate(data['createdAt']),
    updatedAt: toDate(data['updatedAt']),
  };
}

export type EnrollmentWithPeriod = EnrollmentDoc & {
  effectiveSuggestedAmount: number;
  period: DonationPeriodDoc | null;
};

/**
 * Returns all enrollments for a family, joined with their donation period docs.
 * Sorted by enrolledAt DESC (index: status ASC, enrolledAt DESC is the composite
 * index; we query without status filter so Firestore uses a simple collection scan
 * ordered by enrolledAt DESC which doesn't require the composite index).
 */
export async function getEnrollments(fid: string): Promise<EnrollmentWithPeriod[]> {
  const db = portalFirestore();

  const snap = await db
    .collection('families')
    .doc(fid)
    .collection('enrollments')
    .orderBy('enrolledAt', 'desc')
    .get();

  if (snap.empty) return [];

  const enrollments = snap.docs.map((d) => rawToEnrollment(d.data() as Record<string, unknown>));

  const uniquePids = [...new Set(enrollments.map((e) => e.pid))];
  const periodDocs = await Promise.all(
    uniquePids.map((pid) => db.collection('donationPeriods').doc(pid).get()),
  );

  const periodMap = new Map<string, DonationPeriodDoc>();
  for (const doc of periodDocs) {
    if (doc.exists) {
      periodMap.set(doc.id, rawToPeriod(doc.data() as Record<string, unknown>));
    }
  }

  return enrollments.map((e) => {
    const period = periodMap.get(e.pid) ?? null;
    const effectiveSuggestedAmount = e.suggestedAmountOverride ?? e.suggestedAmountSnapshot;
    return { ...e, effectiveSuggestedAmount, period };
  });
}
