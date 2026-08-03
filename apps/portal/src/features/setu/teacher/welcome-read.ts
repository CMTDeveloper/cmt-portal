import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isParticipating, memberMatchesLevel, type LevelDoc, type Location } from '@cmt/shared-domain';

export interface UnassignedStudent {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
}

/** Only the level fields the match needs — lets the page pass the levels it already read. */
export type LevelForMatch = Pick<LevelDoc, 'location' | 'levelKind' | 'gradeBand'>;

/**
 * Children with an active enrollment whose grade/age matches NO enabled level
 * at their location — the §6 data-gap a welcome-team member chases down (grade
 * typo, missing grade, or a level not yet created). Computed, not stored.
 *
 * Returns EVERY location in one pass, because the caller renders every location
 * and the previous per-location signature re-read the whole database once per
 * location.
 *
 * Both reads are deliberately UNFILTERED. A collection-group query with any
 * `where` requires an explicit Firestore index, and the single-field filter
 * this used to carry (`enrollments.status`) had no fieldOverride in either
 * project — so /welcome/levels threw FAILED_PRECONDITION on every request from
 * the day it shipped. Filtering in memory needs no index and no deploy, and is
 * the same shape roster/build-csv-rows.ts and roster/report-dataset.ts use over
 * this exact data.
 */
export async function findUnassignedStudentsByLocation(
  levels: LevelForMatch[],
  now: Date = new Date(),
): Promise<Map<Location, UnassignedStudent[]>> {
  const db = portalFirestore();

  const [enrSnap, memSnap] = await Promise.all([
    db.collectionGroup('enrollments').get(),
    db.collectionGroup('members').get(),
  ]);

  // fid -> the locations where that family is ACTIVELY enrolled. A family can
  // hold enrollments at more than one location, so this is a set, not a value.
  const locationsByFid = new Map<string, Set<Location>>();
  for (const doc of enrSnap.docs) {
    const e = doc.data() as { fid?: unknown; location?: unknown; status?: unknown };
    if (e.status !== 'active') continue;
    if (typeof e.fid !== 'string' || typeof e.location !== 'string' || !e.location) continue;
    const set = locationsByFid.get(e.fid) ?? new Set<Location>();
    set.add(e.location);
    locationsByFid.set(e.fid, set);
  }

  const levelsByLocation = new Map<Location, LevelForMatch[]>();
  for (const l of levels) {
    // LevelDoc.location is nullable. A level belonging to no centre cannot
    // satisfy a child enrolled AT one, so it simply takes part in no comparison.
    if (!l.location) continue;
    const at = levelsByLocation.get(l.location) ?? [];
    at.push(l);
    levelsByLocation.set(l.location, at);
  }

  const out = new Map<Location, UnassignedStudent[]>();
  for (const doc of memSnap.docs) {
    const fid = doc.ref.parent.parent?.id;
    if (!fid) continue;
    const locations = locationsByFid.get(fid);
    if (!locations) continue;

    const m = doc.data() as {
      mid?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      type?: unknown;
      schoolGrade?: unknown;
      birthMonthYear?: unknown;
      participation?: string | null;
    };
    if (m.type !== 'Child') continue;
    // Same reason as the grade-eligible queue: this is the "needs a level"
    // worklist, and a child the family has retired needs nothing.
    if (!isParticipating(m)) continue;
    if (typeof m.mid !== 'string') continue;

    const schoolGrade = typeof m.schoolGrade === 'string' ? m.schoolGrade : null;
    const forMatch = {
      type: 'Child' as const,
      schoolGrade,
      birthMonthYear: typeof m.birthMonthYear === 'string' ? m.birthMonthYear : null,
    };

    for (const location of locations) {
      const here = levelsByLocation.get(location) ?? [];
      if (here.some((lvl) => memberMatchesLevel(forMatch, lvl, now))) continue;
      const list = out.get(location) ?? [];
      list.push({
        mid: m.mid,
        fid,
        // Coerced, not asserted: a name-less member doc is a data problem to
        // show, not a reason to 500 the whole Welcome section on a sort.
        firstName: String(m.firstName ?? ''),
        lastName: String(m.lastName ?? ''),
        schoolGrade,
      });
      out.set(location, list);
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }
  return out;
}
