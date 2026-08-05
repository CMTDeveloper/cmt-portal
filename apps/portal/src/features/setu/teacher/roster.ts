import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { levelGradeSummary, memberMatchesLevel, recordedAllergy, type LevelDoc, type RosterStatus, type SetuAttendanceStatus } from '@cmt/shared-domain';
import { deriveConfirmedFidsForLevel, type LevelEnrollment } from './roster-confirmation';

export interface RosterMemberInput {
  mid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  birthMonthYear: string | null;
  foodAllergies: string | null;
  legacySid: string | null;
}

export interface RosterFamily {
  fid: string;
  legacyFid: string | null;
  /** Mids covered by this family's active enrollment for the offering. */
  enrolledMids: string[];
  members: RosterMemberInput[];
}

export interface RosterEventInput {
  mid: string;
  status: SetuAttendanceStatus;
  isGuest: boolean;
}

export interface RosterMember {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  /** The allergy/medical free-text itself. `hasSafetyInfo` below stays the
   *  derived boolean the safety dot uses, so nothing downstream had to change;
   *  this is the text the teacher and welcome-team screens render (spec §4.3). */
  foodAllergies: string | null;
  hasSafetyInfo: boolean; // allergy/emergency → safety dot on the marker
  status: RosterStatus;
  legacySid: string | null;
  legacyFid: string | null;
}

/** One family's active enrollment for this level's period, reduced to what a
 *  payment verdict needs. Populated only by `deriveRoster`. */
export interface RosterEnrollmentMeta {
  eid: string;
  oid: string;
  enrolledVia: LevelEnrollment['enrolledVia'];
  enrolledMids: string[];
  enrolledAt: Date;
  suggestedAmountOverride: number | null;
  suggestedAmountSnapshot: number | null;
  /** Admin-recorded off-portal settlement. See EnrollmentDocSchema. */
  settledOffPortal: boolean;
}

export interface RosterResult {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string;
  pid: string;
  date: string;
  members: RosterMember[];
  previousStudents: RosterMember[];
  markedCount: number;
  total: number;
  previousTotal: number;
  /**
   * OPTIONAL because `RosterResult` is returned by TWO functions: the pure
   * `buildRoster`, whose `RosterFamily` input carries no enrollment or family
   * doc at all, and `deriveRoster`, which reads both. Making either required
   * would break `buildRoster`'s return and every one of its test call sites for
   * no gain - they are lookup maps for callers that need them, not roster data.
   */
  enrMetaByFid?: Map<string, RosterEnrollmentMeta>;
  /** fid → the family's FIRST manager mid (null when it has none). Free: the
   *  family docs are already batch-read here for `legacyFid`. */
  managerMidByFid?: Map<string, string | null>;
}

/** Firestore `Timestamp` | `Date` | ISO string → `Date`. Same helper the other
 *  payment surfaces use (`build-csv-rows.ts:10-15`). A bare
 *  `new Date(timestamp as string)` yields `Invalid Date`, and the tier lookup
 *  inside `resolveSuggestedAmount` then silently picks the FIRST tier. */
function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return v instanceof Date ? v : new Date(v as string);
}

/**
 * Pure §6 roster builder: enrolled members matching the level kind, merged with
 * the date's attendance events. A matched member with no event is `unaccounted`.
 * Sorted by last name then first. `now` drives shishu age matching.
 */
export function buildRoster(
  level: Pick<LevelDoc, 'levelId' | 'levelName' | 'location' | 'pid' | 'levelKind' | 'gradeBand'>,
  families: RosterFamily[],
  events: RosterEventInput[],
  date: string,
  now: Date,
  confirmedFids: Set<string>,
): RosterResult {
  const statusByMid = new Map<string, SetuAttendanceStatus>();
  for (const e of events) {
    if (!e.isGuest) statusByMid.set(e.mid, e.status);
  }

  const members: RosterMember[] = [];
  const previousStudents: RosterMember[] = [];
  for (const fam of families) {
    // Confirmed families' kids populate `members`; unconfirmed carry-forwards
    // land in `previousStudents` so siblings stay in the same bucket.
    const bucket = confirmedFids.has(fam.fid) ? members : previousStudents;
    for (const m of fam.members) {
      if (!fam.enrolledMids.includes(m.mid)) continue; // only members in the active enrollment
      if (!memberMatchesLevel(m, level, now)) continue;
      const status: RosterStatus = statusByMid.get(m.mid) ?? 'unaccounted';
      bucket.push({
        mid: m.mid,
        fid: fam.fid,
        firstName: m.firstName,
        lastName: m.lastName,
        type: m.type,
        schoolGrade: m.schoolGrade,
        // `recordedAllergy` decides what counts, and BOTH fields are derived
        // from that one call - a lit dot with an empty "Safety & medical" block
        // reads to a teacher as "there is something here and I cannot see it".
        // It returns null for whitespace AND for the "No known allergies"
        // answer, which 104 of the 105 members carrying any value held in
        // production on 2026-08-05.
        foodAllergies: recordedAllergy(m.foodAllergies),
        hasSafetyInfo: recordedAllergy(m.foodAllergies) !== null,
        status,
        legacySid: m.legacySid,
        legacyFid: fam.legacyFid,
      });
    }
  }

  // Sort by first name (then last) — the roster displays "First Last", so this
  // reads alphabetically to a teacher scanning the list.
  const byName = (a: RosterMember, b: RosterMember) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
  members.sort(byName);
  previousStudents.sort(byName);
  const markedCount = members.filter((m) => m.status !== 'unaccounted').length;

  return {
    levelId: level.levelId,
    levelName: level.levelName,
    ageLabel: levelGradeSummary(level),
    location: level.location ?? '',
    pid: level.pid,
    date,
    members,
    previousStudents,
    markedCount,
    total: members.length,
    previousTotal: previousStudents.length,
  };
}

/** Fetch + build the roster for a level on a date. Returns null if level missing. */
export async function deriveRoster(
  levelId: string,
  date: string,
  now: Date = new Date(),
  opts: { withConfirmation?: boolean } = {},
): Promise<RosterResult | null> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(levelId).get();
  if (!levelSnap.exists) return null;
  const level = levelSnap.data() as LevelDoc;

  // Families with an active enrollment for this period at this location.
  const enrollSnap = await db
    .collectionGroup('enrollments')
    .where('pid', '==', level.pid)
    .where('status', '==', 'active')
    .get();

  // fid → enrolledMids for this offering. A family normally has one active
  // enrollment per pid; if somehow more than one, union their enrolledMids.
  const enrolledMidsByFid = new Map<string, string[]>();
  const enrMetaByFid = new Map<string, RosterEnrollmentMeta>();
  for (const d of enrollSnap.docs) {
    const e = d.data() as {
      fid?: string; location?: string; enrolledMids?: string[]; eid?: string; oid?: string;
      enrolledVia?: LevelEnrollment['enrolledVia'];
      // Already in the documents being read — carrying them costs ZERO extra reads.
      enrolledAt?: unknown;
      suggestedAmountOverride?: number | null;
      suggestedAmountSnapshot?: number | null;
      settledOffPortal?: boolean;
    };
    if (e.location !== level.location || typeof e.fid !== 'string') continue;
    const mids = e.enrolledMids ?? [];
    const existing = enrolledMidsByFid.get(e.fid) ?? [];
    const merged = new Set([...existing, ...mids]);
    enrolledMidsByFid.set(e.fid, [...merged]);
    enrMetaByFid.set(e.fid, {
      eid: e.eid ?? `${e.fid}-${e.oid ?? level.pid}`,
      oid: e.oid ?? level.pid,
      enrolledVia: e.enrolledVia ?? 'promotion',
      enrolledMids: mids,
      enrolledAt: toDate(e.enrolledAt),
      suggestedAmountOverride: e.suggestedAmountOverride ?? null,
      suggestedAmountSnapshot: e.suggestedAmountSnapshot ?? null,
      settledOffPortal: e.settledOffPortal === true,
    });
  }
  const fids = [...enrolledMidsByFid.keys()];

  // Bulk reads, NOT a per-family fan-out. The old loop did 2 round-trips per
  // family (family doc + members subcollection) — ~2N calls that made the
  // teacher screens slow on every nav and every autosave. Instead: one batched
  // getAll of the family docs (for legacyFid) and one batched getAll of exactly
  // the enrolled members. Member doc id === mid is the universal write
  // convention, so the enrolled members are addressable directly by mid without
  // scanning each family's whole subcollection. (Matches the bulk pattern in
  // features/setu/roster/report-dataset.ts; needs no new index — getAll is a
  // BatchGetDocuments.)
  const familyRefs = fids.map((fid) => db.collection('families').doc(fid));
  const memberRefs = fids.flatMap((fid) =>
    (enrolledMidsByFid.get(fid) ?? []).map((mid) => db.collection('families').doc(fid).collection('members').doc(mid)),
  );

  const [famDocs, memberDocs, eventsSnap] = await Promise.all([
    familyRefs.length ? db.getAll(...familyRefs) : Promise.resolve([]),
    memberRefs.length ? db.getAll(...memberRefs) : Promise.resolve([]),
    db.collection('attendanceEvents').where('levelId', '==', levelId).where('date', '==', date).get(),
  ]);

  const legacyFidByFid = new Map<string, string | null>();
  // The family's FIRST manager mid, read off the same docs. 893 of 904 UAT
  // families have exactly one manager, 11 have two or three, none have zero
  // (measured 2026-07-26); when there are several, the first is the family's
  // primary contact - the same one the welcome roster shows.
  const managerMidByFid = new Map<string, string | null>();
  for (const fd of famDocs) {
    legacyFidByFid.set(fd.id, (fd.data()?.legacyFid as string | undefined) ?? null);
    const managers = fd.data()?.managers as string[] | undefined;
    managerMidByFid.set(fd.id, Array.isArray(managers) && managers.length > 0 ? managers[0]! : null);
  }

  const membersByFid = new Map<string, RosterMemberInput[]>();
  for (const md of memberDocs) {
    if (!md.exists) continue; // enrolledMid with no member doc (deleted) — skip
    const fid = md.ref.parent.parent?.id;
    if (!fid) continue;
    const m = md.data() as Record<string, unknown>;
    const arr = membersByFid.get(fid) ?? [];
    arr.push({
      mid: m['mid'] as string,
      firstName: m['firstName'] as string,
      lastName: m['lastName'] as string,
      type: m['type'] as 'Adult' | 'Child',
      schoolGrade: (m['schoolGrade'] as string | undefined) ?? null,
      birthMonthYear: (m['birthMonthYear'] as string | undefined) ?? null,
      foodAllergies: (m['foodAllergies'] as string | undefined) ?? null,
      legacySid: (m['legacySid'] as string | undefined) ?? null,
    });
    membersByFid.set(fid, arr);
  }

  const families: RosterFamily[] = fids.map((fid) => ({
    fid,
    legacyFid: legacyFidByFid.get(fid) ?? null,
    enrolledMids: enrolledMidsByFid.get(fid) ?? [],
    members: membersByFid.get(fid) ?? [],
  }));

  const events: RosterEventInput[] = eventsSnap.docs.map((d) => {
    const e = d.data();
    return { mid: e.mid, status: e.status, isGuest: e.isGuest ?? false };
  });

  const fids2 = [...enrMetaByFid.keys()];
  let confirmedFids: Set<string>;
  if (opts.withConfirmation) {
    const legacyFidByFid = new Map(families.map((f) => [f.fid, f.legacyFid]));
    const levelEnrollments: LevelEnrollment[] = [...enrMetaByFid.entries()].map(([fid, m]) => ({
      fid,
      eid: m.eid,
      oid: m.oid,
      enrolledVia: m.enrolledVia,
      enrolledMids: m.enrolledMids,
      legacyFid: legacyFidByFid.get(fid) ?? null,
    }));
    confirmedFids = await deriveConfirmedFidsForLevel(db, level.pid, levelEnrollments);
  } else {
    // Default: everyone confirmed → all members, previousStudents empty (unchanged behavior).
    confirmedFids = new Set(fids2);
  }

  // Spread rather than widen buildRoster: the pure builder has neither map, and
  // making them required on RosterResult would break it and all its call sites.
  return { ...buildRoster(level, families, events, date, now, confirmedFids), enrMetaByFid, managerMidByFid };
}
