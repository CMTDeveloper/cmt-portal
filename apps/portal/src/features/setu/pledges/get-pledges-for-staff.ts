import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';
import type { FamilyPledgeView } from './select-family-pledge';
import { configuredMonthlyAmountCAD } from './pledge-amount';

/**
 * One pledge attempt, as STAFF need to see it.
 *
 * Structurally extends `FamilyPledgeView` (same five fields, same names) so
 * `selectFamilyPledge` accepts these rows unchanged. That is what lets one
 * `pledges` query serve both the payment verdict and the staff history: the
 * ranking rule stays in one place instead of being re-implemented for staff.
 *
 * ── Why this view carries what the family view refuses to ───────────────────
 * `FamilyPledgeView` omits `subscriptionId`, `customerId` and `setupSessionId`
 * because it is serialized into HTML a FAMILY receives, and its own comment says
 * no family screen has business receiving them. That reasoning is about the
 * audience, not about the fields being secret: they are opaque provider handles,
 * not credentials. An admin answering "what happened to my payment?" currently
 * has to hunt for the family in the Stripe dashboard; a `sub_`/`cus_` id turns
 * that into a direct lookup, which is the entire workflow being fixed here.
 *
 * What is still absent, and must stay absent: any bank account, transit or
 * institution number, and any mandate document. The PAD is authorised on a
 * Stripe-hosted page and none of that ever reaches this codebase. A test pins it.
 */
export interface StaffPledgeView extends FamilyPledgeView {
  cancelledAt: Date | null;
  lastCheckedAt: Date | null;
  /** The payment service's OWN words about the last failure, verbatim. */
  lastError: string | null;
  /** A subscription appeared after the pledge left `started` - a human must look. */
  needsStripeVerification: boolean;
  subscriptionId: string | null;
  verifiedSubscriptionId: string | null;
  customerId: string | null;
}

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

function toStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Every pledge attempt this family has made, newest first.
 *
 * ── Query shape: the same deliberate omission as `getFamilyPledge` ──────────
 * A single-field equality on `fid` and NO `orderBy`. Adding one would need a
 * `pledges(fid, startedAt)` composite index this feature does not otherwise
 * require, and the unit suite is index-blind, so the omission would surface only
 * in production as a FAILED_PRECONDITION. A family has a handful of rows;
 * sorting in memory is free.
 *
 * ── Newest-first, NOT the family's ranking ──────────────────────────────────
 * `selectFamilyPledge` ranks `active` above everything so a family's card can
 * never be hijacked by a newer failed attempt. Staff want the opposite: a
 * chronology, because "I tried in January and it bounced, then again in July" is
 * the shape of the question they are answering.
 */
export async function getPledgesForStaff(fid: string): Promise<StaffPledgeView[]> {
  const db = portalFirestore();
  const snap = await db.collection('pledges').where('fid', '==', fid).get();

  const rows: StaffPledgeView[] = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    // Every field NAMED, never a spread of `raw`. Same guarantee the family view
    // documents: a future writer that spreads a provider response into the doc
    // cannot leak it through this mapping, because leaking would require someone
    // to add the field here on purpose.
    return {
      // The document id, not `raw.pid` - they are written together and should
      // agree, but only the id addresses the doc.
      pid: d.id,
      status: raw['status'] as PledgeStatus,
      monthlyAmountCAD:
        typeof raw['monthlyAmountCAD'] === 'number' ? raw['monthlyAmountCAD'] : configuredMonthlyAmountCAD(),
      startedAt: toDate(raw['startedAt']),
      activatedAt: toDateOrNull(raw['activatedAt']),
      cancelledAt: toDateOrNull(raw['cancelledAt']),
      lastCheckedAt: toDateOrNull(raw['lastCheckedAt']),
      lastError: toStringOrNull(raw['lastError']),
      // `=== true`: the field is absent on every pledge written before it
      // existed, and absent must read as "not flagged" rather than letting
      // `undefined` sit in a boolean position.
      needsStripeVerification: raw['needsStripeVerification'] === true,
      subscriptionId: toStringOrNull(raw['subscriptionId']),
      verifiedSubscriptionId: toStringOrNull(raw['verifiedSubscriptionId']),
      customerId: toStringOrNull(raw['customerId']),
    };
  });

  return rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}
