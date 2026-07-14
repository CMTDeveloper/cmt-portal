import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake-firestore harness: the builder reads families, collectionGroup(members),
// collectionGroup(enrollments), collectionGroup(donations), and getAll(offerings).
// We stub portalFirestore() with just those surfaces.
const { fs } = vi.hoisted(() => ({ fs: { data: {} as Record<string, Array<Record<string, unknown>>> } }));

function docSnap(id: string, data: Record<string, unknown>) {
  return { id, exists: true, data: () => data, ref: { parent: { parent: { id: (data['__fid'] as string) ?? id } } } };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      get: async () => ({ docs: (fs.data[name] ?? []).map((d) => docSnap(d['id'] as string, d)) }),
      doc: (id: string) => ({
        id,
        get: async () => {
          const found = (fs.data[name] ?? []).find((d) => d['id'] === id);
          return found ? docSnap(id, found) : { id, exists: false, data: () => undefined };
        },
      }),
    }),
    collectionGroup: (name: string) => ({
      get: async () => ({ docs: (fs.data[name] ?? []).map((d) => docSnap(d['id'] as string, d)) }),
    }),
    getAll: async (...refs: Array<{ get: () => Promise<unknown> }>) => Promise.all(refs.map((r) => r.get())),
  }),
}));

import { buildRosterReportDataset } from '../report-dataset';

beforeEach(() => {
  fs.data = {
    families: [
      { id: 'CMT-RANA', name: 'Rana', location: 'Brampton', legacyFid: '477', publicFid: '1075' },
      { id: 'CMT-SHAH', name: 'Shah', location: 'Scarborough', legacyFid: '', publicFid: '1200' },
    ],
    members: [
      { id: 'm1', __fid: 'CMT-RANA', mid: 'm1', firstName: 'Vaibhav', lastName: 'Rana', type: 'Adult', schoolGrade: '' },
      { id: 'm2', __fid: 'CMT-RANA', mid: 'm2', firstName: 'Harshita', lastName: 'Rana', type: 'Child', schoolGrade: '2' },
      { id: 'm3', __fid: 'CMT-SHAH', mid: 'm3', firstName: 'Aarav', lastName: 'Shah', type: 'Child', schoolGrade: '2' },
    ],
    enrollments: [
      // suggestedAmountOverride pins the expected amount to 200 so `payment` does not
      // depend on resolveSuggestedAmount (empty-tier offerings resolve to 0).
      { id: 'e1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', termLabel: '2026-27', levelName: 'Level 2',
        schoolGrade: '2', enrolledMids: ['m2'], suggestedAmountOverride: 200, suggestedAmountSnapshot: 200, enrolledAt: new Date('2026-09-01') },
      { id: 'e2', __fid: 'CMT-SHAH', fid: 'CMT-SHAH', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', termLabel: '2026-27', levelName: 'Level 2',
        schoolGrade: '2', enrolledMids: ['m3'], suggestedAmountOverride: 200, suggestedAmountSnapshot: 200, enrolledAt: new Date('2026-09-01') },
    ],
    donations: [
      { id: 'd1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'completed', amountCAD: 200, programKey: 'bala-vihar' },
    ],
    offerings: [
      { id: 'off-bv', oid: 'off-bv', programKey: 'bala-vihar', pricingTiers: [], enabled: true },
    ],
  };
});

describe('buildRosterReportDataset', () => {
  it('maps enrollment level/grade onto bvChildren and derives payment from donations', async () => {
    const out = await buildRosterReportDataset({});
    const rana = out.find((f) => f.row.fid === 'CMT-RANA')!;
    const shah = out.find((f) => f.row.fid === 'CMT-SHAH')!;

    expect(rana.row.name).toBe('Rana');
    expect(rana.row.bvChildren).toEqual([{ grade: '2', levelName: 'Level 2' }]);
    expect(rana.row.programKeys).toEqual(['bala-vihar']);
    expect(rana.row.payment).toBe('paid'); // 200 donated >= 200 expected
    expect(shah.row.payment).toBe('outstanding'); // 0 donated < 200 expected

    // Person rows: one per member incl. the adult; the child carries the level.
    const ranaPeople = rana.personRows;
    expect(ranaPeople).toHaveLength(2);
    const child = ranaPeople.find((p) => p.memberName === 'Harshita Rana')!;
    expect(child).toMatchObject({ type: 'Child', grade: '2', level: 'Level 2' });
    const adult = ranaPeople.find((p) => p.memberName === 'Vaibhav Rana')!;
    expect(adult).toMatchObject({ type: 'Adult', level: '' });
  });

  it('year scope: a non-matching year drops families with no active enrollment that year', async () => {
    const out = await buildRosterReportDataset({ year: '2099-00' });
    // No enrollment has termLabel 2099-00, so no family qualifies.
    expect(out).toHaveLength(0);
  });
});
