import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';

export interface AdminPledgeRow {
  pid: string;
  fid: string;
  familyName: string | null;
  status: PledgeStatus;
  monthlyAmountCAD: number;
  startedAt: Date | null;
  activatedAt: Date | null;
  cancelledAt: Date | null;
  /** Whether the portal's own record can still be marked cancelled. */
  cancellable: boolean;
  /**
   * A subscription was created after this pledge left `started`. The id itself
   * is still not projected - an admin cannot act on it from here - but the FACT
   * must be visible, or the flag is recorded and never seen.
   */
  needsStripeVerification: boolean;
}

const MAX_ROWS = 200;

function toDateOrNull(v: unknown): Date | null {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return null;
}

/**
 * Every pledge, newest first, for the admin screen.
 *
 * `orderBy('startedAt','desc')` on a SINGLE field, which Firestore indexes
 * automatically in both directions - no composite index, consistent with every
 * other query in this feature.
 *
 * The provider handles (`setupSessionId`, `subscriptionId`, `customerId`) are
 * deliberately NOT projected. An admin cannot act on them from here, and the
 * screen is rendered into HTML.
 *
 * Family names are joined with ONE bulk read of the fids on the page rather than
 * a per-row get: the repo's standing rule after a per-family fan-out timed out
 * at ~45s across 769 families.
 */
export async function listPledgesForAdmin(): Promise<AdminPledgeRow[]> {
  const db = portalFirestore();
  const snap = await db.collection('pledges').orderBy('startedAt', 'desc').limit(MAX_ROWS).get();

  const rows = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    const status = raw['status'] as PledgeStatus;
    return {
      pid: d.id,
      fid: typeof raw['fid'] === 'string' ? raw['fid'] : '',
      familyName: null as string | null,
      status,
      monthlyAmountCAD: typeof raw['monthlyAmountCAD'] === 'number' ? raw['monthlyAmountCAD'] : 0,
      startedAt: toDateOrNull(raw['startedAt']),
      activatedAt: toDateOrNull(raw['activatedAt']),
      cancelledAt: toDateOrNull(raw['cancelledAt']),
      cancellable: status === 'started' || status === 'active',
      needsStripeVerification: raw['needsStripeVerification'] === true,
    };
  });

  const fids = [...new Set(rows.map((r) => r.fid).filter(Boolean))];
  if (fids.length === 0) return rows;

  const names = new Map<string, string>();
  // getAll takes refs, so this is one round trip regardless of how many fids.
  const famSnaps = await db.getAll(...fids.map((fid) => db.collection('families').doc(fid)));
  for (const f of famSnaps) {
    const name = (f.data() as { name?: unknown } | undefined)?.name;
    if (typeof name === 'string') names.set(f.id, name);
  }

  return rows.map((r) => ({ ...r, familyName: names.get(r.fid) ?? null }));
}
