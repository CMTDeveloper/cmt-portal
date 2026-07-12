import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * Counts how many stored docs still reference a centre location, across every
 * collection that denormalizes `location`. Used by the admin locations editor
 * to refuse removing a centre that families/offerings/levels/enrollments still
 * point at (the name is the key, so a removed centre would orphan them).
 *
 * Uses .count() aggregation (no doc streaming). families/offerings/levels are
 * top-level; enrollments live under families, so it's a collectionGroup query.
 * All are single-field equality => auto-indexed, no composite index needed.
 */
export async function countLocationReferences(location: string): Promise<number> {
  const db = portalFirestore();
  const [fam, off, lvl, enr] = await Promise.all([
    db.collection('families').where('location', '==', location).count().get(),
    db.collection('offerings').where('location', '==', location).count().get(),
    db.collection('levels').where('location', '==', location).count().get(),
    db.collectionGroup('enrollments').where('location', '==', location).count().get(),
  ]);
  return fam.data().count + off.data().count + lvl.data().count + enr.data().count;
}
