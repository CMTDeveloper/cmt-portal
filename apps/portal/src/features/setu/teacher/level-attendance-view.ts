import type { SetuAttendanceStatus } from '@cmt/shared-domain';
import type { RosterPayment } from '@cmt/shared-domain/setu';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { deriveRoster } from './roster';
import { buildAttendanceDetailIndex } from './attendance-detail';
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
  // ── spec §4.4 / §4.3 ────────────────────────────────────────────────────────
  // REQUIRED, not optional: an optional field silently reads `undefined` at a
  // construction site nobody updated, and the row would render blank contact
  // with no error anywhere. Required makes every caller state an answer.
  /** The family's primary manager. Null when none is on file. */
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  /**
   * Four states, but the ROW shows a chip only for `paid` / `outstanding` -
   * those are the two a teacher can act on. `not-applicable` and `unknown` are
   * carried honestly and rendered as no chip at all, because labelling either
   * one would assert something we cannot stand behind.
   */
  payment: RosterPayment;
  /** Allergy / medical free-text, or null. `hasSafetyInfo` remains the boolean
   *  the safety dot uses; this is the text behind it. */
  safetyNotes: string | null;
}

/** A carry-forward (previous) student surfaced inline in the attendance screen's
 *  "Not in this class yet" section. Marking present confirms them in place. */
export interface PreviousStudentRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
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
  /** The carry-forward students themselves (already computed for previousCount),
   *  rendered inline in the "Not in this class yet" section. */
  previousStudents: PreviousStudentRow[];
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
  // LEVEL-scoped, from the BUILT roster: `buildRoster` has already applied
  // memberMatchesLevel. `deriveRoster`'s own fid set is program-and-location
  // scoped (hundreds at prod), and handing that over would reintroduce the very
  // fan-out the detail module caps against.
  const levelFids = [...new Set(roster.members.map((m) => m.fid))];

  const [doorSids, detail] = await Promise.all([
    legacyFids.length > 0 ? readDoorPresentSids(legacyFids, date) : Promise.resolve(new Set<string>()),
    buildAttendanceDetailIndex(
      portalFirestore(),
      levelFids,
      roster.enrMetaByFid ?? new Map(),
      roster.managerMidByFid ?? new Map(),
    ),
  ]);

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
    // A family absent from the detail index degrades to "we know nothing" -
    // never to a crash, and never to a confident `paid`.
    const d = detail.get(m.fid);
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
      parentName: d?.parentName ?? null,
      parentPhone: d?.parentPhone ?? null,
      parentEmail: d?.parentEmail ?? null,
      payment: d?.payment ?? 'unknown',
      // `?? null` is required, not defensive: exactOptionalPropertyTypes rejects
      // the `undefined` a bare read yields against `string | null`.
      safetyNotes: m.foodAllergies ?? null,
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
    previousStudents: roster.previousStudents.map((m) => ({
      mid: m.mid,
      fid: m.fid,
      firstName: m.firstName,
      lastName: m.lastName,
      schoolGrade: m.schoolGrade,
    })),
  };
}
