import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { normalizeGuestChildField } from '@cmt/shared-domain';
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

/**
 * Where a guest row can be corrected: the portal `guest_check_ins` document it
 * came from, and this child's position in that document's `children` array.
 *
 * The index is the address because the array element has no id of its own -
 * `recordGuestCheckIn` stores plain `{name, grade}` objects. Any writer using it
 * MUST therefore compare-and-swap against the values it expects to find there,
 * or a concurrent edit silently rewrites a different child.
 */
export interface GuestChildRef {
  docId: string;
  childIndex: number;
  /**
   * The VISIT's contact, as stored - carried in full rather than reconstructed
   * from the row. `parentName` above is a DISPLAY join of two stored fields, and
   * splitting a joined name back apart guesses wrong on any name that is not
   * exactly two words. The correction form edits these, so it needs the originals.
   */
  contact: { firstName: string; lastName: string; email: string; phone: string };
  /**
   * How many OTHER children checked in on this same visit. The contact belongs
   * to the visit, so correcting it from one child's row necessarily changes it
   * for these too - the form says so, and only when this is non-zero.
   */
  siblingCount: number;
}

/** One door guest check-in child for a date. */
export interface DoorGuestChild {
  name: string;
  grade: string; // door stores string|number; normalized to string here
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
  /**
   * Where to correct this row, or null if it cannot be corrected.
   *
   * Null for LEGACY door rows: those live in the standalone check-in app's own
   * Firebase project (`checkInSourceFirestore`), whose kiosk shut down
   * 2026-08-03. They are history, and history is read-only. Deliberately one
   * nullable field rather than two optional ones, so that both readers are
   * forced by the compiler to state which kind of row they are producing.
   */
  editRef: GuestChildRef | null;
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
            // Another Firebase project, and its kiosk is shut down. Not ours to
            // rewrite - see GuestChildRef.
            editRef: null,
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
 * children: [{name, grade}], date, sessionDate }`; here we flatten every doc's
 * children into the same `DoorGuestChild` shape so the teacher visitors view can
 * merge both sources and match by grade.
 *
 * Keyed on `sessionDate` (the Sunday of the walk-in week), NOT the raw `date`:
 * every teacher surface defaults its ?date= to mostRecentSunday(), so a midweek
 * guest stamped with their real calendar day was invisible. Callers must pass a
 * session Sunday - use `sessionDateFor()`.
 *
 * Both keys are queried for one release. Pre-backfill docs have only `date`, so
 * a straight swap would make every existing guest vanish between the deploy and
 * the prod backfill run - a regression, on a Sunday, introduced by the fix.
 * Drop the `date` leg once the prod backfill has run (runbook 14).
 *
 * Both are single-field equalities on a top-level collection, so both are
 * auto-indexed: no composite index, no firestore.indexes.json change. Tolerant:
 * returns [] if the query fails so a portal-store hiccup never breaks the view.
 */
export async function readPortalGuestChildren(sessionDate: string): Promise<DoorGuestChild[]> {
  const db = portalFirestore();
  let docs: Array<{ id: string; data: () => Record<string, unknown> }>;
  try {
    const [bySession, byDate] = await Promise.all([
      db.collection('guest_check_ins').where('sessionDate', '==', sessionDate).get(),
      db.collection('guest_check_ins').where('date', '==', sessionDate).get(),
    ]);
    // A doc written after this change matches BOTH legs whenever the guest
    // walked in on the Sunday itself, so de-duplicate by doc id.
    const seen = new Set<string>();
    docs = [...bySession.docs, ...byDate.docs].filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  } catch (err) {
    console.error('[portal-guests] query failed for', sessionDate, err);
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
    // Array.isArray, not `?? []`. Documents written before b1395e0 (2026-07-24)
    // carry the OLD shape - a bare `numberOfChildren` count and no `children`
    // key at all. One such doc is still live in UAT
    // (`pdsBr0M0QutelNwyX2vn`, created hours before that commit). `?? []` covers
    // the absent case but not a present-and-not-an-array one, and `for...of`
    // over a number throws, which would take out the whole day's board.
    const kids = Array.isArray(data.children) ? data.children : [];
    kids.forEach((c, childIndex) => {
      out.push({
        // The SAME normalization the correction writer compares against - these
        // rendered values are what the desk sends back as `expected`, so a drift
        // between the two would fail every correction as a phantom conflict.
        name: normalizeGuestChildField(c.name),
        grade: normalizeGuestChildField(c.grade),
        parentEmail,
        parentName,
        phone: data.phone ?? null,
        // The index is into THIS doc's `children`, so it stays valid however the
        // caller later merges, filters or re-groups these rows.
        editRef: {
          docId: doc.id,
          childIndex,
          contact: {
            firstName: normalizeGuestChildField(data.firstName),
            lastName: normalizeGuestChildField(data.lastName),
            email: normalizeGuestChildField(data.email),
            phone: normalizeGuestChildField(data.phone),
          },
          siblingCount: kids.length - 1,
        },
      });
    });
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
