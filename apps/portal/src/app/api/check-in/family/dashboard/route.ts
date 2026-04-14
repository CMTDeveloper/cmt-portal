import { NextResponse } from 'next/server';
import { findFamilyById } from '@/features/check-in/shared';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { CheckInHistoryEntry, FamilyDashboardResponse } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const familyId = req.headers.get('x-portal-family-id');
  if (!familyId) {
    return NextResponse.json({ error: 'no-family-id' }, { status: 401 });
  }

  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

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

  const body: FamilyDashboardResponse = {
    family,
    recentCheckIns,
    paymentStatus: family.paymentStatus,
  };

  return NextResponse.json(body, { status: 200 });
}
