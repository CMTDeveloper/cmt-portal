import { masterRtdb } from '@cmt/firebase-shared/admin/rtdb';

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

async function queryRosterByFid(value: string | number): Promise<RosterRow[]> {
  const snap = await masterRtdb().ref('roster').orderByChild('fid').equalTo(value).get();
  const val = snap.val() as Record<string, RosterRow> | null;
  return val ? Object.values(val) : [];
}

/**
 * Live legacy payment status for a Setu family's `legacyFid`. Scoped RTDB query
 * (only that family's rows). Returns 'unknown' when there's no legacyFid or no
 * matching roster rows (e.g. a brand-new portal family). The roster stores fid
 * as a string or a number depending on vintage, so we try both.
 */
export async function getLegacyPaymentStatus(legacyFid: string | null | undefined): Promise<LegacyPaymentStatus> {
  if (!legacyFid) return 'unknown';
  try {
    let rows = await queryRosterByFid(legacyFid);
    if (rows.length === 0 && /^\d+$/.test(legacyFid)) {
      rows = await queryRosterByFid(Number(legacyFid));
    }
    return derivePaymentStatus(rows);
  } catch (err) {
    console.error('[legacy-payment] roster read failed for', legacyFid, err);
    return 'unknown';
  }
}
