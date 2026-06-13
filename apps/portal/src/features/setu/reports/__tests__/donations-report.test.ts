// apps/portal/src/features/setu/reports/__tests__/donations-report.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildDonationsReport } from '../donations-report';
const mockFs = vi.mocked(portalFirestore);

type SeedDoc = Record<string, unknown>;

function makeDb(donations: SeedDoc[], enrollments: SeedDoc[]) {
  const q = (docs: SeedDoc[]) => ({ get: async () => ({ docs: docs.map((d, i) => ({ id: String(i), data: () => d })) }) });
  return {
    collection: (c: string) => { if (c !== 'donations') throw new Error(c); return q(donations); },
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
});
