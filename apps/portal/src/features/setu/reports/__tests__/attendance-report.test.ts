import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildAttendanceReport } from '../attendance-report';
const mockFs = vi.mocked(portalFirestore);

type SeedDoc = Record<string, unknown> & { levelId?: string };

function makeDb(events: SeedDoc[], levels: SeedDoc[]) {
  // attendanceEvents.where('date','>=',from).where('date','<=',to).get()
  const range = {
    where() { return range; },
    get: async () => ({ docs: events.map((e, i) => ({ id: String(i), data: () => e })) }),
  };
  const lvlQ = { get: async () => ({ docs: levels.map((l, i) => ({ id: l.levelId ?? String(i), data: () => l })) }) };
  return {
    collection: (c: string) => c === 'attendanceEvents' ? range : c === 'levels' ? lvlQ : (() => { throw new Error(c); })(),
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildAttendanceReport', () => {
  it('rolls up present/absent/late per level + per program (N=2 levels, N=2 statuses) with correct rate', async () => {
    mockFs.mockReturnValue(makeDb([
      { levelId: 'l1', pid: 'p1', status: 'present', date: '2026-03-01' },
      { levelId: 'l1', pid: 'p1', status: 'late', date: '2026-03-08' },
      { levelId: 'l1', pid: 'p1', status: 'absent', date: '2026-03-15' },
      { levelId: 'l2', pid: 'p1', status: 'present', date: '2026-03-01' },
    ], [
      { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar' },
      { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar' },
    ]) as never);

    const r = await buildAttendanceReport({ format: 'json', from: '2026-01-01', to: '2026-12-31' });
    const l1 = r.byLevel.find((x) => x.levelId === 'l1')!;
    expect([l1.present, l1.absent, l1.late, l1.total]).toEqual([1, 1, 1, 3]);
    expect(l1.rate).toBeCloseTo(2 / 3); // (present+late)/total
    const bv = r.byProgram.find((x) => x.programKey === 'bala-vihar')!;
    expect(bv.total).toBe(4);
    expect(r.totalEvents).toBe(4);
  });

  it('total=0 yields rate 0 (no divide-by-zero)', async () => {
    mockFs.mockReturnValue(makeDb([], []) as never);
    const r = await buildAttendanceReport({ format: 'json', from: '2026-01-01', to: '2026-12-31' });
    expect(r.byLevel).toEqual([]);
    expect(r.totalEvents).toBe(0);
  });
});
