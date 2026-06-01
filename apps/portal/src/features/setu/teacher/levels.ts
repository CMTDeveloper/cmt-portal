import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { type LevelDoc, levelSlug, toSafeSlug } from '@cmt/shared-domain';

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
 * The enabled levels a teacher (mid or tid) is assigned to — drives the
 * "my levels" teacher dashboard. Requires the
 * `levels (teacherRefs ARRAY_CONTAINS, enabled)` composite index.
 */
export async function getMyLevels(ref: string | null): Promise<LevelDoc[]> {
  if (!ref) return [];
  const snap = await portalFirestore()
    .collection('levels')
    .where('teacherRefs', 'array-contains', ref)
    .where('enabled', '==', true)
    .get();
  return snap.docs
    .map((d) => docToLevel(d.data()))
    .sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '') || a.order - b.order);
}
