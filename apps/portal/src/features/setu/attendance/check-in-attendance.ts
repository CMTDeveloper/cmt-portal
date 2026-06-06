import { checkInSourceFirestore } from './check-in-source';

/**
 * READ-ONLY reader of the live check-in app's `family-check-ins` collection.
 * The standalone chinmaya-family-check-in app owns this collection (families
 * check in at the ashram kiosk; teachers mark attendance) — the portal NEVER
 * writes it. Shape:
 *   family-check-ins/{legacyFid}/checkIns/{YYYY-MM-DD}
 *     → { date, students: [{ sid, isCheckedIn, timestamp }], checkedInBy }
 * Families are keyed by the legacy numeric fid (stored as Setu family.legacyFid);
 * students by legacy sid (stored as Setu member.legacySid after backfill).
 */
export interface CheckInRecord {
  date: string; // YYYY-MM-DD
  checkedInBy: string | null;
  students: Array<{ sid: string; isCheckedIn: boolean }>;
}

export interface CheckInDateMark {
  date: string;
  present: boolean;
}

export interface CheckInSummary {
  attended: number; // dates present
  recorded: number; // dates with a check-in record
  lastDate: string | null;
  marks: CheckInDateMark[]; // ascending by date — drives the heatmap
}

/** All check-in records for a family (newest first), or [] if no legacyFid/none. */
export async function getCheckInAttendance(
  legacyFid: string | null | undefined,
): Promise<CheckInRecord[]> {
  if (!legacyFid) return [];
  try {
    const snap = await checkInSourceFirestore()
      .collection('family-check-ins')
      .doc(legacyFid)
      .collection('checkIns')
      .get();
    return snap.docs
      .map((d) => {
        const x = d.data() as {
          date?: string;
          checkedInBy?: string | null;
          students?: Array<{ sid?: string | number; isCheckedIn?: boolean }>;
        };
        return {
          date: x.date ?? d.id,
          checkedInBy: x.checkedInBy ?? null,
          students: (x.students ?? []).map((s) => ({
            sid: String(s.sid ?? ''),
            isCheckedIn: s.isCheckedIn === true,
          })),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    console.error('[check-in-attendance] read failed for', legacyFid, err);
    return [];
  }
}

/**
 * READ-ONLY: the set of legacy sids checked in at the door for a single date,
 * across the given families. Overlays door self-check-ins onto a teacher
 * roster. Reads `family-check-ins/{legacyFid}/checkIns/{date}` via the seam;
 * tolerates missing docs + read errors (returns what it can). Never writes.
 */
export async function readDoorPresentSids(
  legacyFids: ReadonlyArray<string>,
  date: string,
): Promise<Set<string>> {
  const present = new Set<string>();
  const db = checkInSourceFirestore();
  await Promise.all(
    [...new Set(legacyFids)].map(async (legacyFid) => {
      try {
        const snap = await db
          .collection('family-check-ins').doc(legacyFid)
          .collection('checkIns').doc(date).get();
        if (!snap.exists) return;
        const students = (snap.data()?.students ?? []) as Array<{ sid?: string | number; isCheckedIn?: boolean }>;
        for (const s of students) {
          if (s.isCheckedIn === true && s.sid != null) present.add(String(s.sid));
        }
      } catch (err) {
        console.error('[door-presence] read failed for', legacyFid, date, err);
      }
    }),
  );
  return present;
}

function summarize(marks: CheckInDateMark[]): CheckInSummary {
  const ascending = [...marks].sort((a, b) => a.date.localeCompare(b.date));
  const attended = ascending.filter((m) => m.present).length;
  const lastDate = ascending.length > 0 ? ascending[ascending.length - 1]!.date : null;
  return { attended, recorded: ascending.length, lastDate, marks: ascending };
}

/** Family-level: present on a date if ANY student was checked in. */
export function summarizeFamilyCheckIns(records: CheckInRecord[]): CheckInSummary {
  return summarize(
    records.map((r) => ({ date: r.date, present: r.students.some((s) => s.isCheckedIn) })),
  );
}

/**
 * Per-member: present on the dates where this member's legacy sid appears and
 * isCheckedIn. Dates where the sid isn't in the record are skipped (that child
 * wasn't part of that check-in). Null sid → empty summary.
 */
export function summarizeMemberCheckIns(
  records: CheckInRecord[],
  legacySid: string | null | undefined,
): CheckInSummary {
  if (!legacySid) return summarize([]);
  const marks: CheckInDateMark[] = [];
  for (const r of records) {
    const row = r.students.find((s) => s.sid === legacySid);
    if (row) marks.push({ date: r.date, present: row.isCheckedIn });
  }
  return summarize(marks);
}
