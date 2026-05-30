import { unstable_cacheTag as cacheTag, unstable_cacheLife as cacheLife } from 'next/cache';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

// The pre-portal Bala Vihar payment status, read live from the prod RTDB
// roster (read-only). Used for periods with paymentSource === 'legacy' (the
// 2025-26 cutover year) so families see their real status instead of a
// portal-Stripe "$0".
export type LegacyPaymentStatus = 'paid' | 'partial' | 'unpaid' | 'unknown';

interface RosterRow {
  fid?: string | number;
  payment?: string | number;
}

/** Mirror of the legacy check-in payment derivation, over a family's rows. */
function derivePaymentStatus(rows: RosterRow[]): LegacyPaymentStatus {
  const known = rows
    .map((r) => (r.payment == null ? '' : String(r.payment).trim().toLowerCase()))
    .filter((s) => s.length > 0);
  if (known.length === 0) return 'unknown';
  if (known.some((p) => p.includes('unpaid') || p.includes('due'))) return 'unpaid';
  if (known.some((p) => p.includes('partial'))) return 'partial';
  if (known.every((p) => p.includes('paid'))) return 'paid';
  return 'partial';
}

/**
 * Build a { legacyFid → payment status } index from the whole prod roster.
 *
 * We deliberately read ALL of /roster and group in memory rather than running
 * an `orderByChild('fid').equalTo()` query: the shared prod RTDB has no
 * `.indexOn: "fid"` rule on /roster (and we must not modify the prod rules,
 * since the standalone check-in app owns that database), so the indexed query
 * throws "Index not defined". A full read is what the migration/backfill
 * scripts already do. Cached via Cache Components so the heavy read runs at
 * most once per cacheLife window across the deployment, not per dashboard load.
 */
async function getLegacyPaymentIndex(): Promise<Record<string, LegacyPaymentStatus>> {
  'use cache';
  cacheTag('legacy-roster');
  cacheLife('family');

  const roster = (await readRtdb<Record<string, RosterRow>>('/roster')) ?? {};
  const byFid = new Map<string, RosterRow[]>();
  for (const row of Object.values(roster)) {
    if (row?.fid == null) continue;
    const key = String(row.fid);
    const list = byFid.get(key);
    if (list) list.push(row);
    else byFid.set(key, [row]);
  }

  const index: Record<string, LegacyPaymentStatus> = {};
  for (const [fid, rows] of byFid) index[fid] = derivePaymentStatus(rows);
  return index;
}

/**
 * Live legacy payment status for a Setu family's `legacyFid`. Returns 'unknown'
 * when there's no legacyFid or no matching roster rows (e.g. a brand-new portal
 * family). The roster stores fid as a string or a number depending on vintage,
 * so the index is keyed by the stringified fid.
 */
export async function getLegacyPaymentStatus(
  legacyFid: string | null | undefined,
): Promise<LegacyPaymentStatus> {
  if (!legacyFid) return 'unknown';
  try {
    const index = await getLegacyPaymentIndex();
    return index[String(legacyFid)] ?? 'unknown';
  } catch (err) {
    console.error('[legacy-payment] roster read failed for', legacyFid, err);
    return 'unknown';
  }
}
