import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildEnrollmentReport } from '../enrollment-report';
const mockFs = vi.mocked(portalFirestore);

type SeedDoc = Record<string, unknown> & { id?: string };

// helper builds a db with collectionGroup('enrollments') + collection('levels')
function makeDb(enrollments: SeedDoc[], levels: SeedDoc[]) {
  const q = (docs: SeedDoc[]) => ({ get: async () => ({ docs: docs.map((d, i) => ({ id: d.id ?? String(i), data: () => d })) }) });
  return {
    collectionGroup: (g: string) => { if (g !== 'enrollments') throw new Error(g); return q(enrollments); },
    collection: (c: string) => { if (c !== 'levels') throw new Error(c); return q(levels); },
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildEnrollmentReport', () => {
  it('counts families + members per program (N=2 programs), members per level, ignores cancelled', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1','F1-2'], levelSnapshots: { 'F1-1': { levelId: 'l1', levelName: 'Level 1' }, 'F1-2': { levelId: 'l2', levelName: 'Level 2' } } },
      { fid: 'F2', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: { 'F2-1': { levelId: 'l1', levelName: 'Level 1' } } },
      { fid: 'F2', programKey: 'tabla', programLabel: 'Tabla', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: {} },
      { fid: 'F3', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'cancelled', enrolledMids: ['F3-1'], levelSnapshots: {} },
    ], [
      { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar' },
      { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar' },
    ]) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    const bv = r.byProgram.find((p) => p.programKey === 'bala-vihar')!;
    expect(bv.families).toBe(2);     // F1, F2 (F3 cancelled excluded)
    expect(bv.members).toBe(3);      // F1-1,F1-2,F2-1
    expect(r.byProgram.find((p) => p.programKey === 'tabla')!.families).toBe(1);
    expect(r.byLevel.find((l) => l.levelId === 'l1')!.members).toBe(2); // F1-1, F2-1
    expect(r.totalActiveEnrollments).toBe(3);
  });

  it('program filter narrows to one program', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1'], levelSnapshots: {} },
      { fid: 'F2', programKey: 'tabla', programLabel: 'Tabla', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: {} },
    ], []) as never);
    const r = await buildEnrollmentReport({ format: 'json', program: 'bala-vihar' });
    expect(r.byProgram).toHaveLength(1);
    expect(r.byProgram[0]!.programKey).toBe('bala-vihar');
  });
});
