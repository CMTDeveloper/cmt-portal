import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { CheckInHistoryEntry, FamilyDashboardResponse } from '@cmt/shared-domain/check-in';
import { FamilyDashboard } from '@/features/check-in/family';
import { findFamilyById } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'My family — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function FamilyDashboardPage() {
  if (!flags.checkInFamily) notFound();

  const h = await headers();
  const familyId = h.get('x-portal-family-id');
  if (!familyId) notFound();

  const family = await findFamilyById(familyId);
  if (!family) notFound();

  const snap = await portalFirestore()
    .collection('check_in_events')
    .where('fid', '==', familyId)
    .orderBy('checkedInAt', 'desc')
    .limit(10)
    .get();

  const studentMap = new Map(family.students.map((student) => [student.sid, student]));
  const recentCheckIns: CheckInHistoryEntry[] = snap.docs.map((doc) => {
    const data = doc.data() as {
      sid: string;
      status: 'present' | 'absent';
      checkedInAt: string;
      checkedInBy: 'sevak' | 'family' | 'teacher' | 'guest';
    };
    const student = studentMap.get(data.sid);
    return {
      checkInId: doc.id,
      sid: data.sid,
      firstName: student?.firstName ?? 'Unknown',
      lastName: student?.lastName ?? '',
      status: data.status,
      checkedInAt: data.checkedInAt,
      checkedInBy: data.checkedInBy,
    };
  });

  const response: FamilyDashboardResponse = {
    family,
    recentCheckIns,
    paymentStatus: family.paymentStatus,
  };

  return <FamilyDashboard data={response} />;
}
