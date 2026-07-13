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
  status: SetuAttendanceStatus | null; // present | late | absent — null = unmarked
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
  previousCount: number;
}

/**
 * The teacher attendance screen's read model: the enrollment-gated roster with
 * each kid resolved to a seeded status — a prior portal mark wins, else a door
 * self-check-in seeds Present, else the kid is unmarked (null). The `·door`
 * badge surfaces the self-check-in overlay. null if the level is missing.
 */
export async function getLevelAttendanceView(levelId: string, date: string): Promise<AttendanceView | null> {
  const roster = await deriveRoster(levelId, date, undefined, { withConfirmation: true });
  if (!roster) return null;

  const legacyFids = [...new Set(roster.members.map((m) => m.legacyFid).filter((v): v is string => !!v))];
  const doorSids = legacyFids.length > 0 ? await readDoorPresentSids(legacyFids, date) : new Set<string>();

  const rows: AttendanceViewRow[] = roster.members.map((m) => {
    const checkedInAtDoor = !!m.legacySid && doorSids.has(m.legacySid);
    let status: SetuAttendanceStatus | null;
    let source: AttendanceRowSource;
    if (m.status !== 'unaccounted') {
      status = m.status; // prior teacher mark wins
      source = 'portal';
    } else if (checkedInAtDoor) {
      status = 'present'; // door check-in → present
      source = 'door';
    } else {
      status = null; // unmarked
      source = 'default';
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
    previousCount: roster.previousStudents.length,
  };
}
