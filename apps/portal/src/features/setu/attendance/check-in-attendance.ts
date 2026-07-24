import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
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

/** One door guest check-in child for a date (no portal id — door has none). */
export interface DoorGuestChild {
  name: string;
  grade: string; // door stores string|number; normalized to string here
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
}

/**
 * READ-ONLY: every checked-in guest child at the door for a single date, across
 * all guest families. Mirrors the door app's own read (list `guest-families`,
 * then point-read each family's `checkIns/{date}`) — deliberately INDEX-FREE so
 * it never needs a composite index in prod 715b8. Tolerates missing day-docs and
 * per-family read errors; returns [] if the collection list itself fails.
 */
export async function readDoorGuestCheckIns(date: string): Promise<DoorGuestChild[]> {
  const db = checkInSourceFirestore();
  let familyDocs: Array<{ id: string }>;
  try {
    const list = await db.collection('guest-families').get();
    familyDocs = list.docs;
  } catch (err) {
    console.error('[door-guests] list failed for', date, err);
    return [];
  }

  const out: DoorGuestChild[] = [];
  await Promise.all(
    familyDocs.map(async (fam) => {
      try {
        const snap = await db
          .collection('guest-families').doc(fam.id)
          .collection('checkIns').doc(date).get();
        if (!snap.exists) return;
        const data = (snap.data() ?? {}) as {
          parentName?: string | null;
          phone?: string | null;
          email?: string | null;
          children?: Array<{ name?: string; grade?: string | number; isCheckedIn?: boolean }>;
        };
        const parentEmail = (data.email ?? fam.id) || fam.id;
        for (const c of data.children ?? []) {
          if (c.isCheckedIn !== true) continue;
          out.push({
            name: String(c.name ?? '').trim(),
            grade: c.grade == null ? '' : String(c.grade).trim(),
            parentEmail,
            parentName: data.parentName ?? null,
            phone: data.phone ?? null,
          });
        }
      } catch (err) {
        console.error('[door-guests] read failed for', fam.id, date, err);
      }
    }),
  );
  return out;
}

/**
 * READ-ONLY: every child from the PORTAL's own self-serve guest check-ins for a
 * single date. This is the portal counterpart to `readDoorGuestCheckIns` (which
 * reads the legacy standalone app's `guest-families`). The portal's guest kiosk
 * writes `guest_check_ins/{id}` with `{ firstName, lastName, email, phone,
 * children: [{name, grade}], date }`; here we flatten every doc's children into
 * the same `DoorGuestChild` shape so the teacher visitors view can merge both
 * sources and match by grade. Filters by the `date` field (single-field
 * equality — Firestore auto-indexes it, no composite index needed). Tolerant:
 * returns [] if the query fails so a portal-store hiccup never breaks the view.
 */
export async function readPortalGuestChildren(date: string): Promise<DoorGuestChild[]> {
  const db = portalFirestore();
  let docs: Array<{ data: () => Record<string, unknown> }>;
  try {
    const snap = await db.collection('guest_check_ins').where('date', '==', date).get();
    docs = snap.docs;
  } catch (err) {
    console.error('[portal-guests] query failed for', date, err);
    return [];
  }

  const out: DoorGuestChild[] = [];
  for (const doc of docs) {
    const data = (doc.data() ?? {}) as {
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
      children?: Array<{ name?: string; grade?: string | number }>;
    };
    const parentName = [data.firstName, data.lastName].filter(Boolean).join(' ').trim() || null;
    const parentEmail = (data.email ?? '') || '';
    for (const c of data.children ?? []) {
      out.push({
        name: String(c.name ?? '').trim(),
        grade: c.grade == null ? '' : String(c.grade).trim(),
        parentEmail,
        parentName,
        phone: data.phone ?? null,
      });
    }
  }
  return out;
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
