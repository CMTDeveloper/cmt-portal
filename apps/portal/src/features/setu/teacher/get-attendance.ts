import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { SetuAttendanceStatus } from '@cmt/shared-domain';

export interface AttendanceRecord {
  aid: string;
  mid: string;
  fid: string;
  levelId: string;
  pid: string;
  date: string;
  status: SetuAttendanceStatus;
  isGuest: boolean;
}

export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  total: number;
  /** present + late, over total — the "attended" rate. */
  attendedPct: number;
}

function docToRecord(data: FirebaseFirestore.DocumentData): AttendanceRecord {
  return {
    aid: data.aid,
    mid: data.mid,
    fid: data.fid,
    levelId: data.levelId,
    pid: data.pid,
    date: data.date,
    status: data.status,
    isGuest: data.isGuest ?? false,
  };
}

/** Summarize a set of records (present/late = attended). */
export function summarize(records: Pick<AttendanceRecord, 'status'>[]): AttendanceSummary {
  let present = 0;
  let late = 0;
  let absent = 0;
  for (const r of records) {
    if (r.status === 'present') present++;
    else if (r.status === 'late') late++;
    else if (r.status === 'absent') absent++;
  }
  const total = present + late + absent;
  const attendedPct = total === 0 ? 0 : Math.round(((present + late) / total) * 100);
  return { present, late, absent, total, attendedPct };
}

/** All attendance records for a family's children, newest first. */
export async function getAttendanceForFamily(fid: string): Promise<AttendanceRecord[]> {
  const snap = await portalFirestore()
    .collection('attendanceEvents')
    .where('fid', '==', fid)
    .orderBy('date', 'desc')
    .get();
  return snap.docs.map((d) => docToRecord(d.data()));
}

/** Attendance records for one member, newest first. */
export async function getAttendanceForMember(mid: string): Promise<AttendanceRecord[]> {
  const snap = await portalFirestore()
    .collection('attendanceEvents')
    .where('mid', '==', mid)
    .orderBy('date', 'desc')
    .get();
  return snap.docs.map((d) => docToRecord(d.data()));
}
