import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { levelGradeSummary, memberMatchesLevel, type LevelDoc, type RosterStatus, type SetuAttendanceStatus } from '@cmt/shared-domain';
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
  hasSafetyInfo: boolean; // allergy/emergency → safety dot on the marker
  status: RosterStatus;
  legacySid: string | null;
  legacyFid: string | null;
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
        hasSafetyInfo: Boolean(m.foodAllergies && m.foodAllergies.trim().length > 0),
        status,
        legacySid: m.legacySid,
        legacyFid: fam.legacyFid,
      });
    }
  }

  const byName = (a: RosterMember, b: RosterMember) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
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
  const enrMetaByFid = new Map<string, { eid: string; oid: string; enrolledVia: LevelEnrollment['enrolledVia']; enrolledMids: string[] }>();
  for (const d of enrollSnap.docs) {
    const e = d.data() as { fid?: string; location?: string; enrolledMids?: string[]; eid?: string; oid?: string; enrolledVia?: LevelEnrollment['enrolledVia'] };
    if (e.location !== level.location || typeof e.fid !== 'string') continue;
    const mids = e.enrolledMids ?? [];
    const existing = enrolledMidsByFid.get(e.fid) ?? [];
    const merged = new Set([...existing, ...mids]);
    enrolledMidsByFid.set(e.fid, [...merged]);
    enrMetaByFid.set(e.fid, { eid: e.eid ?? `${e.fid}-${e.oid ?? level.pid}`, oid: e.oid ?? level.pid, enrolledVia: e.enrolledVia ?? 'promotion', enrolledMids: mids });
  }
  const fids = [...enrolledMidsByFid.keys()];

  const [families, eventsSnap] = await Promise.all([
    Promise.all(
      fids.map(async (fid): Promise<RosterFamily> => {
        const [famDoc, memSnap] = await Promise.all([
          db.collection('families').doc(fid).get(),
          db.collection('families').doc(fid).collection('members').get(),
        ]);
        const legacyFid = (famDoc.data()?.legacyFid as string | undefined) ?? null;
        return {
          fid,
          legacyFid,
          enrolledMids: enrolledMidsByFid.get(fid) ?? [],
          members: memSnap.docs.map((d) => {
            const m = d.data();
            return {
              mid: m.mid,
              firstName: m.firstName,
              lastName: m.lastName,
              type: m.type,
              schoolGrade: m.schoolGrade ?? null,
              birthMonthYear: m.birthMonthYear ?? null,
              foodAllergies: m.foodAllergies ?? null,
              legacySid: m.legacySid ?? null,
            };
          }),
        };
      }),
    ),
    db.collection('attendanceEvents').where('levelId', '==', levelId).where('date', '==', date).get(),
  ]);

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

  return buildRoster(level, families, events, date, now, confirmedFids);
}
