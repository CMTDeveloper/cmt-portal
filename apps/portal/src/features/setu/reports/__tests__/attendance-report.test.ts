import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildAttendanceReport } from '../attendance-report';
const mockFs = vi.mocked(portalFirestore);

type SeedDoc = Record<string, unknown> & { levelId?: string };

function makeDb(events: SeedDoc[], levels: SeedDoc[], offerings: SeedDoc[] = []) {
  // attendanceEvents.where('date','>=',from).where('date','<=',to).get()
  const range = {
    where() { return range; },
    get: async () => ({ docs: events.map((e, i) => ({ id: String(i), data: () => e })) }),
  };
  const lvlQ = { get: async () => ({ docs: levels.map((l, i) => ({ id: l.levelId ?? String(i), data: () => l })) }) };
  const offQ = { get: async () => ({ docs: offerings.map((o, i) => ({ id: (o.oid as string) ?? String(i), data: () => o })) }) };
  return {
    collection: (c: string) =>
      c === 'attendanceEvents' ? range : c === 'levels' ? lvlQ : c === 'offerings' ? offQ : (() => { throw new Error(c); })(),
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildAttendanceReport', () => {
  it('folds historical late into present, drops the late column (N=2 levels, 2 present + 1 absent + 1 late)', async () => {
    mockFs.mockReturnValue(makeDb([
      { levelId: 'l1', pid: 'p1', status: 'present', date: '2026-03-01' },
      { levelId: 'l1', pid: 'p1', status: 'present', date: '2026-03-08' },
      { levelId: 'l1', pid: 'p1', status: 'absent', date: '2026-03-15' },
      // Historical `late` mark (pre-Slice-3) — folds INTO present now.
      { levelId: 'l1', pid: 'p1', status: 'late', date: '2026-03-22' },
      { levelId: 'l2', pid: 'p1', status: 'present', date: '2026-03-01' },
    ], [
      { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', pid: 'p1' },
      { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar', pid: 'p1' },
    ], [
      { oid: 'p1', location: 'Brampton', termLabel: '2026-27' },
    ]) as never);

    const r = await buildAttendanceReport({ format: 'json', from: '2026-01-01', to: '2026-12-31' });
    const l1 = r.byLevel.find((x) => x.levelId === 'l1')!;
    expect(l1.present).toBe(3); // 2 present + 1 folded late
    expect(l1.absent).toBe(1);
    expect(l1.total).toBe(4);
    expect(l1.rate).toBeCloseTo(0.75); // present / total
    expect(l1).not.toHaveProperty('late'); // no separate late column
    // Disambiguating context from the level's offering.
    expect(l1.location).toBe('Brampton');
    expect(l1.termLabel).toBe('2026-27');
    const bv = r.byProgram.find((x) => x.programKey === 'bala-vihar')!;
    expect(bv.total).toBe(5);
    expect(bv.present).toBe(4);
    expect(bv).not.toHaveProperty('late');
    expect(r.totalEvents).toBe(5);
  });

  it('disambiguates two same-named levels from different years by location + term (Vaibhav)', async () => {
    mockFs.mockReturnValue(makeDb([
      { levelId: 'l1-cur', pid: 'p-cur', status: 'present', date: '2026-03-01' },
      { levelId: 'l1-prev', pid: 'p-prev', status: 'present', date: '2025-09-01' },
    ], [
      { levelId: 'l1-cur', levelName: 'Level 1', programKey: 'bala-vihar', pid: 'p-cur' },
      { levelId: 'l1-prev', levelName: 'Level 1', programKey: 'bala-vihar', pid: 'p-prev' },
    ], [
      { oid: 'p-cur', location: 'Brampton', termLabel: '2026-27' },
      { oid: 'p-prev', location: 'Brampton', termLabel: '2025-26' },
    ]) as never);

    const r = await buildAttendanceReport({ format: 'json', from: '2025-07-01', to: '2026-06-30' });
    // Both rows share the name "Level 1" but carry distinct term labels.
    expect(r.byLevel.map((x) => x.levelName)).toEqual(['Level 1', 'Level 1']);
    const cur = r.byLevel.find((x) => x.levelId === 'l1-cur')!;
    const prev = r.byLevel.find((x) => x.levelId === 'l1-prev')!;
    expect(cur.termLabel).toBe('2026-27');
    expect(prev.termLabel).toBe('2025-26');
    expect(cur.location).toBe('Brampton');
  });

  it('total=0 yields rate 0 (no divide-by-zero)', async () => {
    mockFs.mockReturnValue(makeDb([], []) as never);
    const r = await buildAttendanceReport({ format: 'json', from: '2026-01-01', to: '2026-12-31' });
    expect(r.byLevel).toEqual([]);
    expect(r.totalEvents).toBe(0);
  });
});
