import type { PledgeStatus } from '@cmt/shared-domain/setu';

/**
 * What the family surfaces need from a pledge. Deliberately NOT the whole
 * document: `setupSessionId`, `subscriptionId` and `customerId` are provider
 * handles that no family screen has any business receiving, and a view type that
 * simply omits them cannot leak them by accident.
 */
export interface FamilyPledgeView {
  pid: string;
  status: PledgeStatus;
  /** Snapshotted at start. What THIS pledge charges - never today's price. */
  monthlyAmountCAD: number;
  startedAt: Date;
  activatedAt: Date | null;
}

/**
 * Rank by what the family most needs told, NOT by recency.
 *
 * A family accumulates rows: a failed first attempt, a cancelled one from last
 * year, a live one. Sorting by date alone would let a newer failed attempt hide
 * an older ACTIVE pledge - the card would show "start giving" to a family whose
 * bank account is being debited every month. Status therefore dominates, and the
 * date only breaks ties within a rank.
 *
 * An unrecognised status ranks LAST rather than first, so a doc written by a
 * future version cannot silently displace a real `active` row.
 */
// Typed by `string`, not `PledgeStatus`, so the lookup below genuinely can miss.
// Keyed by PledgeStatus it would be total by construction, TypeScript would call
// the fallback dead, and the defence against an unknown status would be fiction.
const RANK: Readonly<Record<string, number>> = {
  active: 0,
  started: 1,
  failed: 2,
  cancelled: 2,
};

function rankOf(status: PledgeStatus): number {
  return RANK[status] ?? 99;
}

/**
 * The one pledge the family's card should speak about, or null if they have
 * never started one.
 */
export function selectFamilyPledge(rows: readonly FamilyPledgeView[]): FamilyPledgeView | null {
  let best: FamilyPledgeView | null = null;
  for (const row of rows) {
    if (best === null) {
      best = row;
      continue;
    }
    const d = rankOf(row.status) - rankOf(best.status);
    // Strictly greater on the tie-break, so an equal-ranked, equal-dated pair
    // keeps the first row rather than flip-flopping on iteration order.
    if (d < 0 || (d === 0 && row.startedAt.getTime() > best.startedAt.getTime())) {
      best = row;
    }
  }
  return best;
}
