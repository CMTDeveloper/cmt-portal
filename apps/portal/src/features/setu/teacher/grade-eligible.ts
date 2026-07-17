import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { levelGradeSummary, memberMatchesLevel, type LevelDoc } from '@cmt/shared-domain';

/** A candidate child considered for the "registered · not enrolled" list. */
export interface GradeEligibleCandidate {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  birthMonthYear: string | null;
  familyName: string;
}

export interface GradeEligibleRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  familyName: string;
}

export interface GradeEligibleView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  students: GradeEligibleRow[];
}

/**
 * Pure filter: the candidates who belong on this level by grade/age but are NOT
 * already enrolled for its period. Drives the "Registered · not enrolled" group
 * on the attendance screen. Sorted by first name (then last), matching the
 * enrolled roster's ordering.
 */
export function buildGradeEligibleUnenrolled(
  level: Pick<LevelDoc, 'levelKind' | 'gradeBand'>,
  candidates: readonly GradeEligibleCandidate[],
  enrolledMids: ReadonlySet<string>,
  now: Date,
): GradeEligibleRow[] {
  const rows = candidates
    .filter((m) => !enrolledMids.has(m.mid)) // already on the enrolled roster → skip
    .filter((m) => memberMatchesLevel({ type: m.type, schoolGrade: m.schoolGrade, birthMonthYear: m.birthMonthYear }, level, now))
    .map((m) => ({ mid: m.mid, fid: m.fid, firstName: m.firstName, lastName: m.lastName, schoolGrade: m.schoolGrade, familyName: m.familyName }));
  rows.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
  return rows;
}

/**
 * Read model for the "Registered · not enrolled" group: registered children at
 * the level's location whose grade/age matches the level but who have no active
 * enrollment for its period. Lazy — only fetched when a teacher expands the
 * section — because it is an intentionally broad scan (all members at a location).
 *
 * Bulk reads, no per-family fan-out and NO new Firestore index:
 *  - families-by-location (automatic single-field index)
 *  - one unfiltered collectionGroup('members') read, filtered in memory (same
 *    index-free pattern as the donations read in roster-confirmation.ts)
 *  - the existing enrollments(pid,status) index for the exclusion set
 *
 * Returns null if the level is missing. Grade-eligibility only applies to
 * child-bearing levels; a 'parents' level short-circuits to an empty list before
 * the scan (adults are never "grade eligible").
 */
export async function getGradeEligibleUnenrolled(levelId: string, now: Date = new Date()): Promise<GradeEligibleView | null> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(levelId).get();
  if (!levelSnap.exists) return null;
  const level = levelSnap.data() as LevelDoc;

  const base = { levelId, levelName: level.levelName, ageLabel: levelGradeSummary(level) };
  if (level.levelKind === 'parents') return { ...base, students: [] };

  // Families at this level's location (fid → name).
  const famSnap = await db.collection('families').where('location', '==', level.location).get();
  const locationFids = new Set<string>();
  const familyNameByFid = new Map<string, string>();
  for (const f of famSnap.docs) {
    locationFids.add(f.id);
    familyNameByFid.set(f.id, (f.data().name as string | undefined) ?? f.id);
  }
  if (locationFids.size === 0) return { ...base, students: [] };

  // Children already in an active enrollment for this period — excluded (they're
  // on the enrolled roster already).
  const enrollSnap = await db
    .collectionGroup('enrollments')
    .where('pid', '==', level.pid)
    .where('status', '==', 'active')
    .get();
  const enrolledMids = new Set<string>();
  for (const d of enrollSnap.docs) {
    const e = d.data() as { location?: string; enrolledMids?: string[] };
    if (e.location !== level.location) continue;
    for (const mid of e.enrolledMids ?? []) enrolledMids.add(mid);
  }

  // One collectionGroup read of all members (no index), kept to children at this
  // location. Member doc id === mid, grouped back to its family via parent.parent.
  const membersSnap = await db.collectionGroup('members').get();
  const candidates: GradeEligibleCandidate[] = [];
  for (const md of membersSnap.docs) {
    const fid = md.ref.parent.parent?.id;
    if (!fid || !locationFids.has(fid)) continue;
    const m = md.data() as Record<string, unknown>;
    if (m['type'] !== 'Child') continue;
    candidates.push({
      mid: m['mid'] as string,
      fid,
      firstName: (m['firstName'] as string) ?? '',
      lastName: (m['lastName'] as string) ?? '',
      type: 'Child',
      schoolGrade: (m['schoolGrade'] as string | undefined) ?? null,
      birthMonthYear: (m['birthMonthYear'] as string | undefined) ?? null,
      familyName: familyNameByFid.get(fid) ?? fid,
    });
  }

  return { ...base, students: buildGradeEligibleUnenrolled(level, candidates, enrolledMids, now) };
}
