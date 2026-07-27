import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import { selectFamilyPledge, type FamilyPledgeView } from './select-family-pledge';
import { configuredMonthlyAmountCAD } from './pledge-amount';

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/** Null stays null. `new Date(null)` is 1970, which would read as a real date. */
function toDateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The family's current pledge, as the card should speak about it.
 *
 * ── Query shape ─────────────────────────────────────────────────────────────
 * A single-field equality on `fid`, which Firestore indexes automatically. There
 * is deliberately NO `orderBy`: adding one would require a
 * `pledges(fid, startedAt)` composite index that this feature otherwise does not
 * need, and this suite is index-blind so the omission would only surface in
 * production. A family has a handful of rows, so ranking in memory is free.
 *
 * ── Why the mapping names every field ───────────────────────────────────────
 * The result is serialized into the page HTML the family receives. A spread of
 * the raw document would ship `setupSessionId`, `subscriptionId`, `customerId`
 * and a raw provider error string along with it. Naming the five fields the card
 * uses makes that impossible rather than merely unlikely.
 */
export async function getFamilyPledge(fid: string): Promise<FamilyPledgeView | null> {
  const db = portalFirestore();
  const snap = await db.collection('pledges').where('fid', '==', fid).get();

  const rows: FamilyPledgeView[] = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      // The document id, not `raw.pid`. They are written together and should
      // agree, but only one of them is the thing the finalize route addresses.
      pid: d.id,
      status: raw['status'] as PledgeStatus,
      monthlyAmountCAD:
        typeof raw['monthlyAmountCAD'] === 'number' ? raw['monthlyAmountCAD'] : configuredMonthlyAmountCAD(),
      startedAt: toDate(raw['startedAt']),
      activatedAt: toDateOrNull(raw['activatedAt']),
    };
  });

  return selectFamilyPledge(rows);
}
