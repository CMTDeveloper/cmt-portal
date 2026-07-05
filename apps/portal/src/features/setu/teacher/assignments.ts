import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { findMissingLevelIds } from './levels';

/**
 * teacherAssignments/{ref} — ref is a member `mid` (parent-teachers) or a
 * standalone `tid` (teacher-only sevaks). Mirrors roleAssignments/{mid}: the
 * doc records which levels the teacher covers, and the `teacher` capability is
 * computed from it at session-build time (so it works across a person's
 * multiple contact-derived auth uids). Admin AND welcome-team may write these.
 */
const COLLECTION = 'teacherAssignments';
const LEVELS = 'levels';

interface TeacherAssignmentDocData {
  ref: string;
  levelIds?: string[];
  updatedAt?: FirebaseFirestore.Timestamp;
  updatedByUid?: string;
}

/** The levelIds a teacher is assigned to (empty if none / no doc). */
export async function getTeacherLevelIds(ref: string): Promise<string[]> {
  const snap = await portalFirestore().collection(COLLECTION).doc(ref).get();
  if (!snap.exists) return [];
  const data = snap.data() as TeacherAssignmentDocData | undefined;
  return (data?.levelIds ?? []).filter((l): l is string => typeof l === 'string' && l.length > 0);
}

/** True when the ref (mid or tid) is assigned to at least one level. */
export async function isTeacherAssigned(ref: string): Promise<boolean> {
  const levelIds = await getTeacherLevelIds(ref);
  return levelIds.length > 0;
}

/**
 * Set the exact set of levels a teacher covers. Idempotent: syncs the
 * denormalized `teacherRefs` on each affected level (arrayUnion for newly
 * added, arrayRemove for removed) in one atomic batch alongside the
 * assignment doc. Returns the levels added/removed (+ any `skipped`) to log.
 *
 * PHANTOM-LEVEL GUARD: a merge-set of `teacherRefs` onto a level id that has no
 * doc CREATES a stub `{ teacherRefs }`-only "level" — no `gradeBand`/`levelName`,
 * so it is invisible to rosters (this is exactly how the 2026-27 classes ended
 * up empty). So we never write to a level that does not exist: requested ids
 * whose doc is absent are dropped from the assignment and reported in `skipped`,
 * and no teacherRefs write is issued for them. (The per-level teachers route
 * guards this at its own boundary too; centralizing it here protects EVERY
 * caller — rollover prefill, the create-level flow, and any future one.)
 */
export async function assignTeacher(args: {
  ref: string;
  levelIds: string[];
  byUid: string;
}): Promise<{ added: string[]; removed: string[]; skipped: string[] }> {
  const db = portalFirestore();
  const requested = [...new Set(args.levelIds)];
  const prev = await getTeacherLevelIds(args.ref);

  // Existence check over everything we might write to (requested + prior).
  const universe = [...new Set([...requested, ...prev])];
  const missing = new Set(universe.length ? await findMissingLevelIds(universe) : []);

  const next = requested.filter((l) => !missing.has(l));
  const added = next.filter((l) => !prev.includes(l));
  // Only arrayRemove from levels that still exist — a merge-set arrayRemove on a
  // missing level would ALSO mint a `{ teacherRefs: [] }` phantom.
  const removed = prev.filter((l) => !next.includes(l) && !missing.has(l));
  const skipped = requested.filter((l) => missing.has(l));

  const batch = db.batch();
  batch.set(
    db.collection(COLLECTION).doc(args.ref),
    {
      ref: args.ref,
      levelIds: next,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: args.byUid,
    },
    { merge: true },
  );
  for (const levelId of added) {
    batch.set(
      db.collection(LEVELS).doc(levelId),
      { teacherRefs: FieldValue.arrayUnion(args.ref) },
      { merge: true },
    );
  }
  for (const levelId of removed) {
    batch.set(
      db.collection(LEVELS).doc(levelId),
      { teacherRefs: FieldValue.arrayRemove(args.ref) },
      { merge: true },
    );
  }
  await batch.commit();

  return { added, removed, skipped };
}
