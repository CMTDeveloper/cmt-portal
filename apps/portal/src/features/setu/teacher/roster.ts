import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { memberMatchesLevel, type LevelDoc, type RosterStatus, type SetuAttendanceStatus } from '@cmt/shared-domain';

export interface RosterMemberInput {
  mid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  birthMonthYear: string | null;
  foodAllergies: string | null;
}

export interface RosterFamily {
  fid: string;
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
}

export interface RosterResult {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string;
  pid: string;
  date: string;
  members: RosterMember[];
  markedCount: number;
  total: number;
}

/**
 * Pure §6 roster builder: enrolled members matching the level kind, merged with
 * the date's attendance events. A matched member with no event is `unaccounted`.
 * Sorted by last name then first. `now` drives shishu age matching.
 */
export function buildRoster(
  level: Pick<LevelDoc, 'levelId' | 'levelName' | 'ageLabel' | 'location' | 'pid' | 'levelKind' | 'gradeBand'>,
  families: RosterFamily[],
  events: RosterEventInput[],
  date: string,
  now: Date,
): RosterResult {
  const statusByMid = new Map<string, SetuAttendanceStatus>();
  for (const e of events) {
    if (!e.isGuest) statusByMid.set(e.mid, e.status);
  }

  const members: RosterMember[] = [];
  for (const fam of families) {
    for (const m of fam.members) {
      if (!memberMatchesLevel(m, level, now)) continue;
      const status: RosterStatus = statusByMid.get(m.mid) ?? 'unaccounted';
      members.push({
        mid: m.mid,
        fid: fam.fid,
        firstName: m.firstName,
        lastName: m.lastName,
        type: m.type,
        schoolGrade: m.schoolGrade,
        hasSafetyInfo: Boolean(m.foodAllergies && m.foodAllergies.trim().length > 0),
        status,
      });
    }
  }

  members.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const markedCount = members.filter((m) => m.status !== 'unaccounted').length;

  return {
    levelId: level.levelId,
    levelName: level.levelName,
    ageLabel: level.ageLabel,
    location: level.location,
    pid: level.pid,
    date,
    members,
    markedCount,
    total: members.length,
  };
}

/** Fetch + build the roster for a level on a date. Returns null if level missing. */
export async function deriveRoster(levelId: string, date: string, now: Date = new Date()): Promise<RosterResult | null> {
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
  const fids = [
    ...new Set(
      enrollSnap.docs
        .map((d) => d.data() as { fid?: string; location?: string })
        .filter((e) => e.location === level.location && typeof e.fid === 'string')
        .map((e) => e.fid as string),
    ),
  ];

  const [families, eventsSnap] = await Promise.all([
    Promise.all(
      fids.map(async (fid): Promise<RosterFamily> => {
        const memSnap = await db.collection('families').doc(fid).collection('members').get();
        return {
          fid,
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

  return buildRoster(level, families, events, date, now);
}
