import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** Firestore `in` caps at 30 values; chunk teacher mids defensively. */
function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Bulk-resolve a set of member mids to their "First Last" display names via a
 * single `collectionGroup('members').where('mid','in', …)` read (chunked at 30 —
 * Firestore's `in` cap), never a per-family fan-out. The `members.mid`
 * collection-group index is already UAT-deployed. Members that don't resolve are
 * simply absent from the returned map, so callers pairing mid→name must key by
 * mid (never zip by index). Read-only.
 */
export async function getTeacherNamesByMid(mids: string[]): Promise<Map<string, string>> {
  const db = portalFirestore();
  const unique = [...new Set(mids.filter((m) => m && m.trim().length > 0))];
  const nameByMid = new Map<string, string>();
  if (unique.length === 0) return nameByMid;

  for (const batch of chunk(unique, 30)) {
    if (batch.length === 0) continue;
    const snap = await db.collectionGroup('members').where('mid', 'in', batch).get();
    for (const doc of snap.docs) {
      const m = doc.data() as { mid: string; firstName?: string; lastName?: string };
      nameByMid.set(m.mid, `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim());
    }
  }
  return nameByMid;
}

/**
 * Resolve each Bala Vihar level's assigned teacher display names for the family
 * dashboard's "Class Assignments" line. `teacherRefs` on a level are mids; the
 * teachers are members of (possibly other) families, so names come from the bulk
 * {@link getTeacherNamesByMid} read.
 *
 * Returns a Map keyed by levelId → display names in teacherRefs order. Missing
 * members are skipped (so names[i] may misalign with teacherRefs[i] — pair by
 * mid via {@link getTeacherNamesByMid} when the mid matters); unknown/blank
 * levelIds are absent from the map. Read-only.
 */
export async function getBvTeacherNames(levelIds: string[]): Promise<Map<string, string[]>> {
  const db = portalFirestore();
  const unique = [...new Set(levelIds.filter((id) => id && id.trim().length > 0))];
  if (unique.length === 0) return new Map();

  // 1) level docs → teacherRefs
  const levelDocs = await Promise.all(unique.map((id) => db.collection('levels').doc(id).get()));
  const refsByLevel = new Map<string, string[]>();
  const allMids = new Set<string>();
  for (let i = 0; i < unique.length; i++) {
    const d = levelDocs[i]!;
    if (!d.exists) continue;
    const refs = ((d.data() as { teacherRefs?: string[] } | undefined)?.teacherRefs ?? []).filter(Boolean);
    refsByLevel.set(unique[i]!, refs);
    refs.forEach((m) => allMids.add(m));
  }

  // 2) bulk member lookup → mid → "First Last"
  const nameByMid = await getTeacherNamesByMid([...allMids]);

  // 3) levelId → teacher names in teacherRefs order (skip unresolved / blank names)
  const out = new Map<string, string[]>();
  for (const [levelId, refs] of refsByLevel) {
    out.set(
      levelId,
      refs.map((mid) => nameByMid.get(mid)).filter((n): n is string => !!n && n.length > 0),
    );
  }
  return out;
}
