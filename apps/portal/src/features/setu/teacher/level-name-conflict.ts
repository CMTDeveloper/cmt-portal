/**
 * Level-name uniqueness within a (location, period) group.
 *
 * A level's doc id is frozen from its name at create time (`levelIdFor`), so a
 * later rename leaves the id untouched — two levels in the same location+pid can
 * end up displaying the same name (the id-collision backstop only catches an
 * exact frozen-id clash, never a rename that lands on a sibling's display name).
 * These helpers enforce normalized-name uniqueness on both create and rename.
 */

/** Normalize a level name for collision comparison: trim, collapse spaces, lowercase. */
export function normalizeLevelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The levelId of an EXISTING level in the same (location, pid) whose name
 * normalizes-equal to `normalizedName`, or null. Single-field `pid` query (no
 * composite index); location + name compared in memory. `exceptLevelId` skips the
 * level being renamed so a no-op rename never conflicts with itself.
 *
 * Uses the ambient `FirebaseFirestore.Firestore` type — `@cmt/firebase-shared`
 * does not re-export the `Firestore` type.
 */
export async function findNameConflict(
  db: FirebaseFirestore.Firestore,
  args: { location: string; pid: string; normalizedName: string; exceptLevelId?: string },
): Promise<string | null> {
  const snap = await db.collection('levels').where('pid', '==', args.pid).get();
  for (const doc of snap.docs) {
    if (doc.id === args.exceptLevelId) continue;
    const d = doc.data() as { location?: unknown; levelName?: unknown };
    if (d.location !== args.location) continue;
    if (typeof d.levelName !== 'string') continue;
    if (normalizeLevelName(d.levelName) === args.normalizedName) return doc.id;
  }
  return null;
}
