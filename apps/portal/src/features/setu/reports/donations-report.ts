// apps/portal/src/features/setu/reports/donations-report.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { DonationsReport, ReportQuery } from '@cmt/shared-domain';
import { paymentFromAmounts } from '@/features/setu/roster/payment';

// The donations summary is ALL-TIME, bucketed by donation period (`pid`). It
// intentionally does NOT honor `params.from`/`params.to` — donations carry a
// `createdAt` timestamp (not the YMD the schema validates), and "by period" is
// the product-meaningful grouping. Only `params.program` narrows the result.
export async function buildDonationsReport(params: ReportQuery): Promise<DonationsReport> {
  const db = portalFirestore();
  const [donSnap, enrSnap] = await Promise.all([
    db.collection('donations').get(),
    db.collectionGroup('enrollments').get(),
  ]);

  type Agg = { cad: number; count: number; label: string; programLabel: string };
  const byPeriod = new Map<string, Agg>();
  const byProgram = new Map<string, Agg>();
  let totalCompletedCAD = 0;

  for (const d of donSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (x['status'] !== 'completed') continue;
    if (params.program && x['programKey'] !== params.program) continue;
    const amt = typeof x['amountCAD'] === 'number' ? x['amountCAD'] : 0;
    totalCompletedCAD += amt;
    const pid = typeof x['pid'] === 'string' ? x['pid'] : '(none)';
    const programKey = typeof x['programKey'] === 'string' ? x['programKey'] : '(general)';
    const label = typeof x['label'] === 'string' ? x['label'] : pid;
    const programLabel = typeof x['programLabel'] === 'string' ? x['programLabel'] : programKey;
    const pAgg = byPeriod.get(pid) ?? { cad: 0, count: 0, label, programLabel };
    pAgg.cad += amt; pAgg.count++; byPeriod.set(pid, pAgg);
    const gAgg = byProgram.get(programKey) ?? { cad: 0, count: 0, label: programLabel, programLabel };
    gAgg.cad += amt; gAgg.count++; byProgram.set(programKey, gAgg);
  }

  // paid vs outstanding families (bulk; expected via snapshot/override, no live offering recompute).
  // When `params.program` is set, BOTH the expected-enrollment and paid-donation
  // sides are scoped to that program — otherwise a program-filtered report would
  // show that program's dollar totals against org-wide payment chips.
  const expectedByFid = new Map<string, number>();
  const activeCountByFid = new Map<string, number>();
  for (const d of enrSnap.docs) {
    const e = d.data() as Record<string, unknown>;
    if (e['status'] !== 'active') continue;
    if (params.program && e['programKey'] !== params.program) continue;
    const fid = String(e['fid'] ?? '');
    if (!fid) continue;
    const override = typeof e['suggestedAmountOverride'] === 'number' ? (e['suggestedAmountOverride'] as number) : null;
    const snapshot = typeof e['suggestedAmountSnapshot'] === 'number' ? (e['suggestedAmountSnapshot'] as number) : 0;
    expectedByFid.set(fid, (expectedByFid.get(fid) ?? 0) + (override ?? snapshot));
    activeCountByFid.set(fid, (activeCountByFid.get(fid) ?? 0) + 1);
  }
  const paidByFid = new Map<string, number>();
  for (const d of donSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (x['status'] !== 'completed') continue;
    if (params.program && x['programKey'] !== params.program) continue;
    const fid = String(x['fid'] ?? '');
    if (!fid) continue;
    paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + (typeof x['amountCAD'] === 'number' ? (x['amountCAD'] as number) : 0));
  }
  let paidFamilies = 0, outstandingFamilies = 0;
  for (const [fid, expected] of expectedByFid) {
    const status = paymentFromAmounts(activeCountByFid.get(fid) ?? 0, expected, paidByFid.get(fid) ?? 0);
    if (status === 'paid') paidFamilies++;
    else if (status === 'outstanding') outstandingFamilies++;
  }

  return {
    byPeriod: [...byPeriod.entries()].map(([pid, a]) => ({ pid, label: a.label, programLabel: a.programLabel, completedCAD: a.cad, completedCount: a.count })).sort((x, y) => x.label.localeCompare(y.label)),
    byProgram: [...byProgram.entries()].map(([programKey, a]) => ({ programKey, programLabel: a.programLabel, completedCAD: a.cad, completedCount: a.count })).sort((x, y) => x.programKey.localeCompare(y.programKey)),
    paidFamilies, outstandingFamilies, totalCompletedCAD,
  };
}
