import { FieldValue } from '@cmt/firebase-shared/admin/firestore';

type Db = FirebaseFirestore.Firestore;

export interface SevaCopyResult {
  fromYear: string;
  toYear: string;
  created: string[];
  existing: string[];
}

/** +364 days keeps the same weekday (52 weeks). */
function shift364(d: Date): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + 364);
  return n;
}

/**
 * Selectively copy chosen seva opportunities from `fromYear` into `toYear`.
 *
 * Optional rollover convenience: an admin picks the `oppIds` to bring forward.
 * Each copied opp's `date` shifts +364 days (same weekday), `sevaYear` becomes
 * `toYear`, and the actor is recorded. `decideLater:false` opens the copy
 * immediately (`status:'open'`); `decideLater:true` lands it as `status:'draft'`
 * so families NEVER see it (the family browse list is `status:'open'`) until an
 * admin reschedules + opens it — the +364d date is just a placeholder.
 *
 * Idempotent on the deterministic target id `${sourceOppId}-${toYear}`: a source
 * whose `sevaYear !== fromYear` (or that doesn't exist) is skipped, and an
 * already-present target is reported as `existing` and NOT overwritten.
 */
export async function copySevaOpportunities(
  db: Db,
  args: { fromYear: string; toYear: string; oppIds: string[]; decideLater: boolean; actorMid: string },
): Promise<SevaCopyResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const oppId of args.oppIds) {
    const srcSnap = await db.collection('seva_opportunities').doc(oppId).get();
    if (!srcSnap.exists) continue;
    const src = srcSnap.data() as Record<string, unknown>;
    if (src['sevaYear'] !== args.fromYear) continue; // only copy fromYear items

    const targetId = `${oppId}-${args.toYear}`;
    const ref = db.collection('seva_opportunities').doc(targetId);
    if ((await ref.get()).exists) {
      existing.push(targetId);
      continue;
    }

    const srcDate =
      (src['date'] as { toDate?: () => Date }).toDate?.() ?? new Date(src['date'] as string);

    created.push(targetId);
    const now = FieldValue.serverTimestamp();
    await ref.set({
      oppId: targetId,
      title: src['title'],
      description: (src['description'] as string | undefined) ?? '',
      date: shift364(srcDate),
      location: (src['location'] as string | undefined) ?? '',
      defaultHours: src['defaultHours'],
      capacity: (src['capacity'] as number | null | undefined) ?? null,
      sevaYear: args.toYear,
      status: args.decideLater ? 'draft' : 'open',
      createdAt: now,
      createdBy: args.actorMid,
      updatedAt: now,
      updatedBy: args.actorMid,
    });
  }

  return { fromYear: args.fromYear, toYear: args.toYear, created, existing };
}
