import type { SetuAttendanceStatus } from '@cmt/shared-domain';
import { deriveRoster } from './roster';
import { readDoorPresentSids } from '@/features/setu/attendance/check-in-attendance';

export type AttendanceRowSource = 'portal' | 'door' | 'default';

export interface AttendanceViewRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  hasSafetyInfo: boolean;
  status: SetuAttendanceStatus; // present | late | absent — defaults to present
  source: AttendanceRowSource;
  checkedInAtDoor: boolean;
}

export interface AttendanceView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string;
  pid: string;
  date: string;
  rows: AttendanceViewRow[];
  presentCount: number;
  total: number;
}

/**
 * The teacher attendance screen's read model: the enrollment-gated roster with
 * each kid resolved to a DEFAULT-PRESENT status, a prior portal mark winning,
 * and a read-only door self-check-in overlay (the `·door` badge). null if the
 * level is missing.
 */
export async function getLevelAttendanceView(levelId: string, date: string): Promise<AttendanceView | null> {
  const roster = await deriveRoster(levelId, date);
  if (!roster) return null;

  const legacyFids = [...new Set(roster.members.map((m) => m.legacyFid).filter((v): v is string => !!v))];
  const doorSids = legacyFids.length > 0 ? await readDoorPresentSids(legacyFids, date) : new Set<string>();

  const rows: AttendanceViewRow[] = roster.members.map((m) => {
    const checkedInAtDoor = !!m.legacySid && doorSids.has(m.legacySid);
    let status: SetuAttendanceStatus = 'present';
    let source: AttendanceRowSource = checkedInAtDoor ? 'door' : 'default';
    if (m.status !== 'unaccounted') {
      status = m.status;
      source = 'portal';
    }
    return {
      mid: m.mid,
      fid: m.fid,
      firstName: m.firstName,
      lastName: m.lastName,
      schoolGrade: m.schoolGrade,
      hasSafetyInfo: m.hasSafetyInfo,
      status,
      source,
      checkedInAtDoor,
    };
  });

  const presentCount = rows.filter((r) => r.status === 'present').length;
  return {
    levelId: roster.levelId,
    levelName: roster.levelName,
    ageLabel: roster.ageLabel,
    location: roster.location,
    pid: roster.pid,
    date: roster.date,
    rows,
    presentCount,
    total: rows.length,
  };
}
