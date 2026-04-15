import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type {
  CheckInHistoryEntry,
  Family,
} from '@cmt/shared-domain/check-in';

interface StoredCheckInEvent {
  sid: string;
  status: 'present' | 'absent';
  checkedInAt: string;
  checkedInBy: 'sevak' | 'family' | 'teacher' | 'guest';
}

// firestore.indexes.json declares the composite index (fid ASC, checkedInAt DESC)
// required by this query. Apply it before deploying: firebase deploy --only firestore:indexes
export async function loadRecentFamilyCheckIns(
  family: Family,
  limit = 10,
): Promise<CheckInHistoryEntry[]> {
  const snap = await portalFirestore()
    .collection('check_in_events')
    .where('fid', '==', family.fid)
    .orderBy('checkedInAt', 'desc')
    .limit(limit)
    .get();

  const studentMap = new Map(family.students.map((student) => [student.sid, student]));
  return snap.docs.map((doc) => {
    const data = doc.data() as StoredCheckInEvent;
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
}
