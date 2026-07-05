import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { type LevelDoc, levelSlug, toSafeSlug } from '@cmt/shared-domain';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';

/** Deterministic level doc id: `{location}-{levelSlug}-{pid}`. */
export function levelIdFor(location: string, levelName: string, pid: string): string {
  return `${toSafeSlug(location)}-${levelSlug(levelName)}-${pid}`;
}

type TS = ReturnType<typeof Timestamp.now>;

function docToLevel(data: FirebaseFirestore.DocumentData): LevelDoc {
  return {
    ...(data as LevelDoc),
    createdAt: (data.createdAt as TS).toDate(),
    updatedAt: (data.updatedAt as TS).toDate(),
  };
}

/** All levels for the admin list, ordered by location then display order. */
export async function getLevels(): Promise<LevelDoc[]> {
  const snap = await portalFirestore()
    .collection('levels')
    .orderBy('location', 'asc')
    .orderBy('order', 'asc')
    .get();
  return snap.docs.map((d) => docToLevel(d.data()));
}

/**
 * The enabled levels a teacher (mid or tid) is assigned to for the LIVE school
 * year — drives the "my levels" teacher dashboard, the mobile teacher-levels API,
 * and teacher student-detail access. Requires the
 * `levels (teacherRefs ARRAY_CONTAINS, enabled)` composite index.
 *
 * The live-year filter is IN-MEMORY (a teacher is on a handful of levels), so it
 * needs no extra composite index: a teacher carried across a rollover is assigned
 * to BOTH last year's and this year's level (e.g. two "Level 1" docs), and must
 * only see the current year's class — otherwise the dashboard shows a duplicate,
 * empty prior-year card next to the populated live one.
 */
export async function getMyLevels(ref: string | null): Promise<LevelDoc[]> {
  if (!ref) return [];
  const liveYear = await getLiveSchoolYearCached();
  const snap = await portalFirestore()
    .collection('levels')
    .where('teacherRefs', 'array-contains', ref)
    .where('enabled', '==', true)
    .get();
  return snap.docs
    .map((d) => docToLevel(d.data()))
    .filter((l) => l.periodLabel === liveYear)
    .sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '') || a.order - b.order);
}

/**
 * Of the given level ids, the ones with no `levels/{id}` doc. Used to reject a
 * teacher assignment that references a non-existent level (which would otherwise
 * create a phantom partial level doc via the denormalized teacherRefs write).
 * Deduplicates input; preserves first-seen order in the result.
 */
export async function findMissingLevelIds(levelIds: string[]): Promise<string[]> {
  const unique = [...new Set(levelIds)];
  if (unique.length === 0) return [];
  const db = portalFirestore();
  const refs = unique.map((id) => db.collection('levels').doc(id));
  const snaps = await db.getAll(...refs);
  return unique.filter((_, i) => !snaps[i]!.exists);
}
