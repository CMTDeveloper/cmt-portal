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
 * `enrollFamily`, whose already-active branch writes nothing UNLESS the caller
 * explicitly supplies `enrolledMids` / `suggestedAmountOverride` /
 * `membershipMode` - the Adult Study Class does, to let a family change which
 * adult attends). Without this
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
 * EXCEPT when the enrollment carries `membershipMode: 'manual'`, where the
 * family named its members deliberately and only DEPARTED members are dropped.
 * Absent mode = `'auto'` = the behaviour above, which is every enrollment that
 * existed before the Adult Study Class.
 *
 * ⚠️ ASYMMETRY, ON PURPOSE - do not "fix" it. `enrollFamily` refuses to ever
 * WRITE an empty `enrolledMids` (it throws `no-eligible-members` on both the
 * create and reconcile paths), but this prune may legitimately LEAVE one: when
 * the last enrolled member departs, the truthful state is an active enrollment
 * naming nobody. Keeping stale mids instead would put a departed child on a
 * teacher's roster, which is strictly worse. The empty list is also the signal
 * the adult-class gate keys on to ask the family to choose again.
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

  // Every mid that currently exists on the family, regardless of eligibility.
  // A MANUAL selection is filtered by EXISTENCE only - see below.
  const existingMids = new Set(
    members.map((m) => m.mid).filter((mid): mid is string => typeof mid === 'string'),
  );

  for (const enrDoc of enrSnap.docs) {
    const e = enrDoc.data() as {
      eid?: string;
      programKey?: string;
      enrolledMids?: string[];
      membershipMode?: 'auto' | 'manual';
    };
    if (!e.programKey) continue;

    if (!programByKey.has(e.programKey)) {
      programByKey.set(e.programKey, await getProgram(e.programKey));
    }
    const program = programByKey.get(e.programKey);
    if (!program || program.status !== 'active') continue;

    // MANUAL: the family named these members deliberately (the Adult Study
    // Class asks which non-teaching adult attends). Re-deriving would re-enrol
    // the parent teaching that hour and silently overwrite their choice. So the
    // prune may only DROP mids for people who have left the family.
    //
    // Placed AFTER the program-active guard on purpose: "a paused or removed
    // program never mutates rosters" is an invariant of this whole function, and
    // a manual enrollment is not an exception to it.
    //
    // Filtered by EXISTENCE, never by eligibility - and note this DEVIATES from
    // spec 4.3b step 3, which says manual also prunes the no-longer-eligible.
    // The spec is wrong: `memberEligibleForProgram` is clock-dependent (age
    // bounds), so an eligibility-filtered manual list could empty ITSELF on a
    // birthday with no user action, re-firing the adult-class gate and asking
    // the family to re-choose for no reason. A member who merely became
    // ineligible staying enrolled is the far milder failure, and it is visible
    // and fixable. The spec has been corrected to match.
    //
    // Filters `enrolledMids`, NOT `members`: that preserves the ORDER the family
    // chose. Filtering `members` would silently reorder to Firestore doc order,
    // and `sameSet` is order-insensitive so nothing would ever flag it - while
    // load-dashboard maps `enrolledMids` in order for display.
    //
    // Dropping departed members is load-bearing rather than incidental: an
    // emptied list is exactly what makes the gate re-fire (spec 2.1 condition 4)
    // so the family is asked to choose someone still in the household.
    if (e.membershipMode === 'manual') {
      const stored = e.enrolledMids ?? [];
      const kept = stored.filter((mid) => existingMids.has(mid));
      if (!sameSet(stored, kept)) {
        batch.update(enrDoc.ref, { enrolledMids: kept });
        updated.push(e.eid ?? enrDoc.id);
      }
      continue;
    }

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
