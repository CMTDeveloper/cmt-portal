import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin, type WithRole } from '@cmt/shared-domain';

/**
 * May this session take/read attendance for a level? Admin (inherits) always
 * can; otherwise the session's member mid must be in the level's teacherRefs.
 * Returns 'level-not-found' so the route can 404 vs 403 distinctly.
 */
export async function canTeachLevel(
  session: WithRole & { mid?: string | null },
  levelId: string,
): Promise<'ok' | 'forbidden' | 'level-not-found'> {
  const snap = await portalFirestore().collection('levels').doc(levelId).get();
  if (!snap.exists) return 'level-not-found';
  if (isAdmin(session)) return 'ok';
  const teacherRefs = (snap.data()?.teacherRefs ?? []) as string[];
  if (session.mid && teacherRefs.includes(session.mid)) return 'ok';
  return 'forbidden';
}
