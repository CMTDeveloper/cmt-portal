import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { assignTeacher, getTeacherLevelIds } from '@/features/setu/teacher/assignments';
import { balaViharSourceOidsForYear, targetOidOf } from './school-year';

type Db = FirebaseFirestore.Firestore;

export interface TeacherPrefillResult {
  fromYear: string;
  toYear: string;
  filled: string[];
  skipped: string[];
}

/** Compute a level's next-year twin id EXACTLY as startNewYear does: swap the
 *  source oid suffix for the target oid (suffix-aware, with a replace fallback). */
function swapLevelId(levelId: string, fromOid: string, toOid: string): string {
  return levelId.endsWith(fromOid)
    ? levelId.slice(0, -fromOid.length) + toOid
    : levelId.replace(fromOid, toOid);
}

/**
 * Optional, opt-in teacher pre-fill for the school-year rollover. For each
 * source-year Bala Vihar level with a non-empty `teacherRefs`, copy those refs
 * into its matching next-year level — but ONLY when the target's `teacherRefs`
 * is empty, so an admin's deliberate assignment is NEVER clobbered. Runs AFTER
 * startNewYear (which seeds next-year levels with `teacherRefs: []`).
 * Idempotent: a re-run finds the target already populated and reports it as
 * skipped. A missing twin is skipped, not created.
 */
export async function prefillTeachers(
  db: Db,
  args: { fromYear: string; toYear: string; dryRun: boolean; actorMid: string },
): Promise<TeacherPrefillResult> {
  const fromOids = balaViharSourceOidsForYear(args.fromYear);
  const filled: string[] = [];
  const skipped: string[] = [];

  // Single-field `in` query on pid → no composite index required.
  const srcLevels = await db.collection('levels').where('pid', 'in', fromOids).get();
  for (const doc of srcLevels.docs) {
    const lvl = doc.data();
    const refs = (lvl['teacherRefs'] ?? []) as string[];
    if (refs.length === 0) continue;

    const toOid = targetOidOf(String(lvl['pid']), args.fromYear, args.toYear);
    const targetId = swapLevelId(String(lvl['levelId']), String(lvl['pid']), toOid);
    const targetRef = db.collection('levels').doc(targetId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      skipped.push(targetId);
      continue;
    }

    const targetRefs = (targetSnap.data()!['teacherRefs'] ?? []) as string[];
    if (targetRefs.length > 0) {
      skipped.push(targetId); // never clobber an admin assignment
      continue;
    }

    filled.push(targetId);
    if (!args.dryRun) {
      // Sync BOTH sources of truth. assignTeacher writes each ref's
      // `teacherAssignments/{ref}.levelIds` (drives the `teacher` capability +
      // the admin "levels & teachers" pills) AND arrayUnions the ref onto
      // `levels/{targetId}.teacherRefs` (drives getMyLevels). A plain
      // `targetRef.set({ teacherRefs })` updated only the level, leaving the
      // assignment doc stale after rollover → an empty teacher list. Union
      // per ref so we never drop the ref's OTHER (e.g. source-year) levels.
      for (const ref of refs) {
        const next = [...new Set([...(await getTeacherLevelIds(ref)), targetId])];
        await assignTeacher({ ref, levelIds: next, byUid: args.actorMid });
      }
      // assignTeacher doesn't stamp the level's own audit fields; keep the
      // `updatedAt/updatedBy` the admin levels screen renders for this carry.
      await targetRef.set(
        { updatedAt: FieldValue.serverTimestamp(), updatedBy: args.actorMid },
        { merge: true },
      );
    }
  }

  return { fromYear: args.fromYear, toYear: args.toYear, filled, skipped };
}
