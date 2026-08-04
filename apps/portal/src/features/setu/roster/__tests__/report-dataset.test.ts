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
    collection: (name: string) => {
      const rows = () => (fs.data[name] ?? []).map((d) => docSnap(d['id'] as string, d));
      return {
        get: async () => ({ docs: rows() }),
        doc: (id: string) => ({
          id,
          get: async () => {
            const found = (fs.data[name] ?? []).find((d) => d['id'] === id);
            return found ? docSnap(id, found) : { id, exists: false, data: () => undefined };
          },
        }),
        where: (field: string, op: string, value: unknown) => ({
          get: async () => ({
            docs: rows().filter((s) => {
              const v = (s.data() as Record<string, unknown>)[field];
              return op === 'in' ? Array.isArray(value) && value.includes(v) : v === value;
            }),
          }),
        }),
      };
    },
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
      { id: 'm1', __fid: 'CMT-RANA', mid: 'm1', firstName: 'Vaibhav', lastName: 'Rana', type: 'Adult', schoolGrade: '', manager: true },
      { id: 'm2', __fid: 'CMT-RANA', mid: 'm2', firstName: 'Harshita', lastName: 'Rana', type: 'Child', schoolGrade: '2' },
      { id: 'm3', __fid: 'CMT-SHAH', mid: 'm3', firstName: 'Aarav', lastName: 'Shah', type: 'Child', schoolGrade: '6' },
    ],
    enrollments: [
      // The enrollment does NOT carry per-child level (real BV enrollments have no
      // levelName); the builder derives level from the child's grade + the level's
      // gradeBand, keyed by pid (falls back to oid here). suggestedAmountOverride pins
      // the expected amount to 200 so payment is deterministic.
      { id: 'e1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', termLabel: '2026-27',
        enrolledMids: ['m2'], suggestedAmountOverride: 200, suggestedAmountSnapshot: 200, enrolledAt: new Date('2026-09-01') },
      { id: 'e2', __fid: 'CMT-SHAH', fid: 'CMT-SHAH', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', termLabel: '2026-27',
        enrolledMids: ['m3'], suggestedAmountOverride: 200, suggestedAmountSnapshot: 200, enrolledAt: new Date('2026-09-01') },
    ],
    donations: [
      // eid matches Rana's enrollment (CMT-RANA-off-bv) → confirms it (issue #23).
      { id: 'd1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'completed', amountCAD: 200, eid: 'CMT-RANA-off-bv', programKey: 'bala-vihar' },
    ],
    // Shah has no attendance + no donation → its promotion carry-forward stays Registered.
    attendanceEvents: [],
    offerings: [
      // A real tier: an offering with EMPTY pricingTiers now means something
      // specific (a free program → payment 'not-applicable'), so a fixture that
      // leaves them empty while pinning an override silently stops testing the
      // pricing path at all.
      { id: 'off-bv', oid: 'off-bv', programKey: 'bala-vihar', enabled: true,
        pricingTiers: [{ effectiveFrom: '2026-09-01', amountCAD: 500, label: 'Full year' }] },
    ],
    // Level = child grade matched to a gradeBand, keyed by the enrollment's pid.
    levels: [
      { id: 'lvl2', pid: 'off-bv', levelName: 'Level 2', programKey: 'bala-vihar', location: 'Brampton', gradeBand: ['2', '3'] },
      { id: 'lvl4', pid: 'off-bv', levelName: 'Level 4', programKey: 'bala-vihar', location: 'Scarborough', gradeBand: ['6', '7'] },
    ],
  };
});

describe('buildRosterReportDataset', () => {
  it('maps enrollment level/grade onto bvChildren and derives payment from donations', async () => {
    const out = await buildRosterReportDataset({});
    const rana = out.find((f) => f.row.fid === 'CMT-RANA')!;
    const shah = out.find((f) => f.row.fid === 'CMT-SHAH')!;

    expect(rana.row.name).toBe('Rana');
    // parentName = the family's adult(s); Rana has one adult manager.
    expect(rana.row.parentName).toBe('Vaibhav Rana');
    // Shah has only a child member -> parentName falls back to the family name.
    expect(shah.row.parentName).toBe('Shah');
    // Level derived from grade band, NOT a stored enrollment field: grade 2 -> Level 2.
    expect(rana.row.bvChildren).toEqual([{ grade: '2', levelName: 'Level 2' }]);
    // grade 6 -> Level 4 (different level, proving per-child grade-band derivation).
    expect(shah.row.bvChildren).toEqual([{ grade: '6', levelName: 'Level 4' }]);
    expect(rana.row.programKeys).toEqual(['bala-vihar']);
    expect(rana.row.payment).toBe('paid'); // 200 donated >= 200 expected
    expect(shah.row.payment).toBe('outstanding'); // 0 donated < 200 expected

    // Issue #23 engagement: Rana's completed donation matches its enrollment eid →
    // confirmed ("Enrolled"). Shah is a bare promotion carry-forward → registered.
    expect(rana.row.bvEngagement).toBe('confirmed');
    expect(shah.row.bvEngagement).toBe('registered');

    // Person rows: one per member incl. the adult; the child carries the level.
    const ranaPeople = rana.personRows;
    expect(ranaPeople).toHaveLength(2);
    const child = ranaPeople.find((p) => p.memberName === 'Harshita Rana')!;
    expect(child).toMatchObject({ type: 'Child', grade: '2', level: 'Level 2' });
    const adult = ranaPeople.find((p) => p.memberName === 'Vaibhav Rana')!;
    expect(adult).toMatchObject({ type: 'Adult', level: '' });
  });

  // This builder is the live surface behind BOTH the /welcome/roster payload and
  // the CSV export, so every payment verdict has to be pinned here and not only
  // in build-csv-rows.test.ts, which exercises a different function over the same
  // rule. One family per way of owing nothing, plus the N=2 mixed case.
  it('payment: free and waived read not-applicable; unpriceable and off-portal read unknown', async () => {
    fs.data.families = [
      { id: 'CMT-FREE', name: 'Free', location: 'Brampton', legacyFid: '', publicFid: null },
      { id: 'CMT-WAIVED', name: 'Waived', location: 'Brampton', legacyFid: '', publicFid: null },
      { id: 'CMT-GHOST', name: 'Ghost', location: 'Brampton', legacyFid: '', publicFid: null },
      { id: 'CMT-TEACHER', name: 'Teacher', location: 'Brampton', legacyFid: '', publicFid: null },
      { id: 'CMT-LEGACY', name: 'Legacy', location: 'Brampton', legacyFid: '477', publicFid: null },
      { id: 'CMT-MIXED', name: 'Mixed', location: 'Brampton', legacyFid: '', publicFid: null },
    ];
    fs.data.members = [];
    fs.data.donations = [];
    fs.data.attendanceEvents = [];
    const base = { status: 'active', termLabel: '2026-27', enrolledMids: [], enrolledAt: new Date('2026-09-01') };
    fs.data.enrollments = [
      { id: 'x1', __fid: 'CMT-FREE', fid: 'CMT-FREE', ...base, programKey: 'om-chanting', programLabel: 'Om Chanting', oid: 'off-free' },
      { id: 'x2', __fid: 'CMT-WAIVED', fid: 'CMT-WAIVED', ...base, programKey: 'adult-study-class', programLabel: 'Adult Study Class', oid: 'off-asc', suggestedAmountOverride: 0 },
      // No offering doc exists for off-gone, and the snapshot is 0.
      { id: 'x3', __fid: 'CMT-GHOST', fid: 'CMT-GHOST', ...base, programKey: 'bala-vihar', programLabel: 'Bala Vihar', oid: 'off-gone' },
      { id: 'x4', __fid: 'CMT-TEACHER', fid: 'CMT-TEACHER', ...base, programKey: 'tabla', programLabel: 'Tabla', oid: 'off-tm' },
      { id: 'x5', __fid: 'CMT-LEGACY', fid: 'CMT-LEGACY', ...base, programKey: 'bala-vihar', programLabel: 'Bala Vihar', oid: 'off-legacy' },
      { id: 'x6a', __fid: 'CMT-MIXED', fid: 'CMT-MIXED', ...base, programKey: 'om-chanting', programLabel: 'Om Chanting', oid: 'off-free' },
      { id: 'x6b', __fid: 'CMT-MIXED', fid: 'CMT-MIXED', ...base, programKey: 'bala-vihar', programLabel: 'Bala Vihar', oid: 'off-bv' },
    ];
    fs.data.offerings = [
      ...(fs.data.offerings ?? []),
      { id: 'off-free', oid: 'off-free', programKey: 'om-chanting', pricingTiers: [], enabled: true },
      { id: 'off-asc', oid: 'off-asc', programKey: 'adult-study-class', pricingTiers: [{ effectiveFrom: '2026-09-01', amountCAD: 101, label: 'Full year' }], enabled: true },
      { id: 'off-tm', oid: 'off-tm', programKey: 'tabla', pricingTiers: [], paymentSource: 'teacher-managed', enabled: true },
      { id: 'off-legacy', oid: 'off-legacy', programKey: 'bala-vihar', pricingTiers: [], paymentSource: 'legacy', enabled: true },
    ];

    const out = await buildRosterReportDataset({});
    const pay = (fid: string) => out.find((f) => f.row.fid === fid)!.row.payment;
    expect(pay('CMT-FREE')).toBe('not-applicable');
    // The waiver wins over the offering's $101 - that is the whole point of it.
    expect(pay('CMT-WAIVED')).toBe('not-applicable');
    expect(pay('CMT-GHOST')).toBe('unknown');
    expect(pay('CMT-TEACHER')).toBe('unknown');
    expect(pay('CMT-LEGACY')).toBe('unknown');
    // N=2: the priced Bala Vihar enrollment still owes $500 beside the free one.
    expect(pay('CMT-MIXED')).toBe('outstanding');
  });

  it('year scope: a non-matching year drops families with no active enrollment that year', async () => {
    const out = await buildRosterReportDataset({ year: '2099-00' });
    // No enrollment has termLabel 2099-00, so no family qualifies.
    expect(out).toHaveLength(0);
  });

  it('bvEngagement: attendance mark and family-initiated both confirm; no active BV → null', async () => {
    fs.data.enrollments = [
      { id: 'e1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'active', programKey: 'bala-vihar', programLabel: 'Bala Vihar',
        oid: 'off-bv', pid: 'off-bv', termLabel: '2026-27', enrolledVia: 'promotion', enrolledMids: ['m2'], enrolledAt: new Date('2026-09-01') },
      { id: 'e2', __fid: 'CMT-SHAH', fid: 'CMT-SHAH', status: 'active', programKey: 'bala-vihar', programLabel: 'Bala Vihar',
        oid: 'off-bv', pid: 'off-bv', termLabel: '2026-27', enrolledVia: 'family-initiated', enrolledMids: ['m3'], enrolledAt: new Date('2026-09-01') },
    ];
    fs.data.donations = [];
    // A present mark for Rana's child m2 (pid off-bv) graduates the promotion → confirmed.
    fs.data.attendanceEvents = [{ id: 'a1', pid: 'off-bv', mid: 'm2', status: 'present' }];
    // A 3rd family with NO active BV enrollment → null.
    fs.data.families = [...(fs.data.families ?? []), { id: 'CMT-NONE', name: 'None', location: 'Brampton', legacyFid: '', publicFid: null }];

    const out = await buildRosterReportDataset({});
    expect(out.find((f) => f.row.fid === 'CMT-RANA')!.row.bvEngagement).toBe('confirmed'); // attendance mark
    expect(out.find((f) => f.row.fid === 'CMT-SHAH')!.row.bvEngagement).toBe('confirmed'); // family-initiated
    expect(out.find((f) => f.row.fid === 'CMT-NONE')!.row.bvEngagement).toBeNull();        // no active BV
  });
  // ── The welcome roster's answer for a family settled off-portal (2026-08-04) ─
  //
  // The end-to-end version of the production report: an admin marked a real
  // family as paying CMT by a long-standing pre-authorized debit, and THIS
  // dataset - the only source behind /welcome/roster - answered "N/A", so the
  // family vanished from the Paid filter. The domain test pins the verdict; this
  // one pins the PLUMBING, which is where a new field silently fails to arrive.
  it('payment: an admin-settled enrollment reads PAID, the identical waiver still reads N/A', async () => {
    fs.data.families = [
      { id: 'CMT-SETTLED', name: 'Settled', location: 'Brampton', legacyFid: '', publicFid: '5006' },
      { id: 'CMT-WAIVED', name: 'Waived', location: 'Brampton', legacyFid: '', publicFid: '5007' },
    ];
    fs.data.members = [
      { id: 'm1', __fid: 'CMT-SETTLED', mid: 'm1', firstName: 'A', lastName: 'A', type: 'Child', schoolGrade: '2' },
      { id: 'm2', __fid: 'CMT-WAIVED', mid: 'm2', firstName: 'B', lastName: 'B', type: 'Child', schoolGrade: '2' },
    ];
    fs.data.enrollments = [
      // Both are `suggestedAmountOverride: 0`. The ONLY difference is the flag.
      { id: 'e1', __fid: 'CMT-SETTLED', fid: 'CMT-SETTLED', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', pid: 'off-bv', termLabel: '2026-27', enrolledMids: ['m1'],
        suggestedAmountOverride: 0, settledOffPortal: true, suggestedAmountSnapshot: 500, enrolledAt: new Date('2026-09-01') },
      { id: 'e2', __fid: 'CMT-WAIVED', fid: 'CMT-WAIVED', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', pid: 'off-bv', termLabel: '2026-27', enrolledMids: ['m2'],
        suggestedAmountOverride: 0, suggestedAmountSnapshot: 500, enrolledAt: new Date('2026-09-01') },
    ];
    fs.data.donations = [];
    fs.data.attendanceEvents = [];

    const out = await buildRosterReportDataset({});
    const pay = (fid: string) => out.find((f) => f.row.fid === fid)!.row.payment;
    expect(pay('CMT-SETTLED')).toBe('paid');
    expect(pay('CMT-WAIVED')).toBe('not-applicable');
  });
});
