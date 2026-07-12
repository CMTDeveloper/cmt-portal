import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * Counts how many stored docs still reference a centre location, across every
 * collection that denormalizes `location`. Used by the admin locations editor
 * to refuse removing a centre that stored docs still point at (the name is the
 * key, so a removed centre would orphan them). Checks all seven denormalized
 * sources:
 *   - families            - `location` field (top-level equality)
 *   - offerings           - `location` field (top-level equality)
 *   - levels              - `location` field (top-level equality)
 *   - enrollments         - `location` field, but under families (collectionGroup)
 *   - programs            - `locations` array field (array-contains)
 *   - classCalendarEntries- `location` field (top-level equality)
 *   - weeklySchedules     - doc-id IS the location (per-centre schedule header)
 *
 * Uses .count() aggregation (no doc streaming) for the query-backed sources and
 * a single doc `.get()` for the doc-id-keyed weeklySchedules. All but one are
 * auto-indexed: top-level single-field equality queries, the single-field
 * array-contains on programs, and the doc get need no explicit index. The lone
 * exception is enrollments: it lives under families, so it's a collectionGroup
 * query - and a collectionGroup single-field query is NOT auto-indexed. It needs
 * the `enrollments.location` COLLECTION_GROUP field-override in
 * firestore.indexes.json (without it that line throws FAILED_PRECONDITION and
 * the remove-guard 500s). Deploy that override before this runs in any
 * environment.
 */
export async function countLocationReferences(location: string): Promise<number> {
  const db = portalFirestore();
  const [fam, off, lvl, enr, prog, cal, weekly] = await Promise.all([
    db.collection('families').where('location', '==', location).count().get(),
    db.collection('offerings').where('location', '==', location).count().get(),
    db.collection('levels').where('location', '==', location).count().get(),
    db.collectionGroup('enrollments').where('location', '==', location).count().get(),
    db.collection('programs').where('locations', 'array-contains', location).count().get(),
    db.collection('classCalendarEntries').where('location', '==', location).count().get(),
    db.collection('weeklySchedules').doc(location).get(),
  ]);
  return (
    fam.data().count +
    off.data().count +
    lvl.data().count +
    enr.data().count +
    prog.data().count +
    cal.data().count +
    (weekly.exists ? 1 : 0)
  );
}
