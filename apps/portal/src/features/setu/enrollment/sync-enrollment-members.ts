import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { memberEligibleForProgram } from '@cmt/shared-domain';
import { getProgram } from '@/features/setu/programs/get-programs';

export interface SyncEnrollmentMembersResult {
  /** eids whose `enrolledMids` were rewritten (empty when nothing changed). */
  updated: string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

/**
 * Reconciles every ACTIVE enrollment's `enrolledMids` to the family's current
 * set of program-eligible members.
 *
 * `enrolledMids` is a denormalized snapshot frozen at enroll time (see
 * `enrollFamily`, whose already-active branch is a strict no-op). Without this
 * it goes stale the moment family membership changes — a child added AFTER the
 * family enrolled never joins the enrollment, so the dashboard/roster/attendance
 * (all of which read `enrolledMids`) silently omit them. That is the N=2 bug.
 *
 * The enrollment model enrols ALL eligible members (there is no per-child
 * opt-in on the enroll page), so "currently-eligible members" is the correct
 * target set: this ADDS newly-eligible members AND DROPS members who left the
 * family or became ineligible (e.g. a deleted child, or a child edited to
 * Adult). Call it after every member add / edit / delete.
 *
 * Idempotent: only enrollments whose member set actually changed are written,
 * and the whole reconcile is a no-op when the family has no active enrollment.
 * Enrollments whose program doc is missing or not `active` are left untouched
 * (we never want a paused/removed program to mutate rosters).
 */
export async function syncActiveEnrollmentMemberships(
  fid: string,
  now: Date = new Date(),
): Promise<SyncEnrollmentMembersResult> {
  const db = portalFirestore();

  const [memSnap, enrSnap] = await Promise.all([
    db.collection('families').doc(fid).collection('members').get(),
    db
      .collection('families')
      .doc(fid)
      .collection('enrollments')
      .where('status', '==', 'active')
      .get(),
  ]);

  if (enrSnap.empty) return { updated: [] };

  const members = memSnap.docs.map(
    (d) => d.data() as { mid?: string; type?: 'Adult' | 'Child'; birthMonthYear?: string | null },
  );

  const programByKey = new Map<string, Awaited<ReturnType<typeof getProgram>>>();
  const batch = db.batch();
  const updated: string[] = [];

  for (const enrDoc of enrSnap.docs) {
    const e = enrDoc.data() as { eid?: string; programKey?: string; enrolledMids?: string[] };
    if (!e.programKey) continue;

    if (!programByKey.has(e.programKey)) {
      programByKey.set(e.programKey, await getProgram(e.programKey));
    }
    const program = programByKey.get(e.programKey);
    if (!program || program.status !== 'active') continue;

    // Eligible members, in member-doc order (fid-01, fid-02, …) so the child
    // display order on the dashboard stays stable across re-syncs.
    const eligible = members
      .filter(
        (m): m is { mid: string; type: 'Adult' | 'Child'; birthMonthYear?: string | null } =>
          typeof m.mid === 'string' && (m.type === 'Adult' || m.type === 'Child'),
      )
      .filter((m) =>
        memberEligibleForProgram(
          { type: m.type, birthMonthYear: m.birthMonthYear ?? null },
          program.eligibility,
          now,
        ),
      )
      .map((m) => m.mid);

    if (!sameSet(e.enrolledMids ?? [], eligible)) {
      batch.update(enrDoc.ref, { enrolledMids: eligible });
      updated.push(e.eid ?? enrDoc.id);
    }
  }

  if (updated.length > 0) await batch.commit();
  return { updated };
}
