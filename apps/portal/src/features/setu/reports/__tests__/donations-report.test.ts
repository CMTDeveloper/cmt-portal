// apps/portal/src/features/setu/reports/__tests__/donations-report.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildDonationsReport } from '../donations-report';
const mockFs = vi.mocked(portalFirestore);

type SeedDoc = Record<string, unknown>;

// `periods` is keyed by pid (the doc id) so the year→pid mapping resolves.
function makeDb(donations: SeedDoc[], enrollments: SeedDoc[], periods: Record<string, SeedDoc> = {}) {
  const q = (docs: SeedDoc[]) => ({ get: async () => ({ docs: docs.map((d, i) => ({ id: String(i), data: () => d })) }) });
  const periodEntries = Object.entries(periods);
  const periodQ = { get: async () => ({ docs: periodEntries.map(([id, d]) => ({ id, data: () => d })) }) };
  return {
    collection: (c: string) => {
      if (c === 'donations') return q(donations);
      if (c === 'donationPeriods') return periodQ;
      throw new Error(c);
    },
    collectionGroup: (g: string) => { if (g !== 'enrollments') throw new Error(g); return q(enrollments); },
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildDonationsReport', () => {
  it('sums completed by period + program (N=2 periods), ignores non-completed', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', pid: 'p1', label: 'BV 2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 100 },
      { fid: 'F2', pid: 'p1', label: 'BV 2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 150 },
      { fid: 'F3', pid: 'p2', label: 'Tabla 2025', programKey: 'tabla', programLabel: 'Tabla', status: 'redirected', amountCAD: 80 }, // not completed
    ], [
      { fid: 'F1', status: 'active', suggestedAmountSnapshot: 100, suggestedAmountOverride: null },
      { fid: 'F2', status: 'active', suggestedAmountSnapshot: 200, suggestedAmountOverride: null },
    ]) as never);

    const r = await buildDonationsReport({ format: 'json' });
    expect(r.totalCompletedCAD).toBe(250);
    expect(r.byPeriod.find((p) => p.pid === 'p1')!.completedCAD).toBe(250);
    expect(r.byPeriod.find((p) => p.pid === 'p1')!.completedCount).toBe(2);
    // F1 paid (100>=100), F2 outstanding (150<200)
    expect(r.paidFamilies).toBe(1);
    expect(r.outstandingFamilies).toBe(1);
  });

  it('scopes BOTH dollar totals AND paid/outstanding family counts to params.program', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', pid: 'bv', label: 'BV', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 100 },
      { fid: 'F2', pid: 'tb', label: 'Tabla', programKey: 'tabla', programLabel: 'Tabla', status: 'completed', amountCAD: 50 },
    ], [
      { fid: 'F1', programKey: 'bala-vihar', status: 'active', suggestedAmountSnapshot: 100, suggestedAmountOverride: null }, // paid (100>=100)
      { fid: 'F2', programKey: 'tabla', status: 'active', suggestedAmountSnapshot: 200, suggestedAmountOverride: null }, // outstanding (50<200)
    ]) as never);

    const r = await buildDonationsReport({ format: 'json', program: 'bala-vihar' });
    // dollar totals scoped to bala-vihar
    expect(r.totalCompletedCAD).toBe(100);
    // family counts ALSO scoped: only F1 (bala-vihar) counts; F2 (tabla) excluded
    expect(r.paidFamilies).toBe(1);
    expect(r.outstandingFamilies).toBe(0);
  });

  it('year filter: only donations whose pid maps to that year (via donationPeriods.periodLabel) count', async () => {
    mockFs.mockReturnValue(makeDb([
      // p25 → 2025-26, p24 → 2024-25 (see periods map below). pNull has no period doc.
      { fid: 'F1', pid: 'p25', label: 'BV 2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 100 },
      { fid: 'F2', pid: 'p24', label: 'BV 2024-25', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 999 },
      { fid: 'F3', pid: 'pNull', label: 'General', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 50 },
    ], [
      { fid: 'F1', termLabel: '2025-26', status: 'active', suggestedAmountSnapshot: 100, suggestedAmountOverride: null }, // paid (100>=100)
      { fid: 'F2', termLabel: '2024-25', status: 'active', suggestedAmountSnapshot: 200, suggestedAmountOverride: null }, // other year — excluded
    ], {
      p25: { periodLabel: '2025-26' },
      p24: { periodLabel: '2024-25' },
    }) as never);

    const r = await buildDonationsReport({ format: 'json', year: '2025-26' });
    // Only F1's p25 donation counts; F2 (other year) + F3 (no period) excluded.
    expect(r.totalCompletedCAD).toBe(100);
    expect(r.byPeriod.map((p) => p.pid)).toEqual(['p25']);
    // Expected-enrollment side also scoped to 2025-26 → only F1 (paid).
    expect(r.paidFamilies).toBe(1);
    expect(r.outstandingFamilies).toBe(0);
  });

  it('no year param ⇒ all-time (every completed donation counts, periods optional)', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', pid: 'p25', label: 'BV 2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 100 },
      { fid: 'F2', pid: 'p24', label: 'BV 2024-25', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 200 },
    ], [] /* no enrollments */) as never);

    const r = await buildDonationsReport({ format: 'json' });
    expect(r.totalCompletedCAD).toBe(300); // both years
  });
});
