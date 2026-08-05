import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
// Legacy roster read is a cached RTDB call — mock it so the report stays pure.
const { getLegacyPaymentStatus } = vi.hoisted(() => ({ getLegacyPaymentStatus: vi.fn() }));
vi.mock('@/features/setu/donations/legacy-payment', () => ({ getLegacyPaymentStatus }));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildEnrollmentReport } from '../enrollment-report';
const mockFs = vi.mocked(portalFirestore);

type SeedDoc = Record<string, unknown> & { id?: string };

interface Extra {
  families?: Array<{ id: string; legacyFid?: string | null }>;
  donations?: Array<{ fid: string; status: string; eid: string | null; amountCAD: number }>;
  attendance?: Array<{ pid: string; mid: string; status: string }>;
  offerings?: Record<string, { paymentSource?: string; location?: string | null; termLabel?: string }>;
  members?: Array<{ id?: string; mid: string; type?: 'Adult' | 'Child'; schoolGrade?: string | null; birthMonthYear?: string | null }>;
}

// Chainable fake supporting: collectionGroup('enrollments'|'donations'),
// collection('levels'|'families'|'attendanceEvents'|'offerings'), getAll(...refs).
function makeDb(enrollments: SeedDoc[], levels: SeedDoc[], extra: Extra = {}) {
  const families = extra.families ?? [];
  const donations = extra.donations ?? [];
  const attendance = extra.attendance ?? [];
  const offerings = extra.offerings ?? {};

  const snap = (docs: SeedDoc[]) => ({ docs: docs.map((d, i) => ({ id: d.id ?? String(i), data: () => d })) });
  const cgDonationDocs = donations.map((d, i) => ({
    id: `d${i}`,
    ref: { parent: { parent: { id: d.fid } } },
    data: () => d,
  }));

  return {
    collectionGroup: (g: string) => {
      if (g === 'enrollments') return { get: async () => snap(enrollments) };
      if (g === 'donations') return { get: async () => ({ docs: cgDonationDocs }) };
      // Members feed the live level derivation used when an enrollment has no
      // levelSnapshots - which, in production, is all of them.
      if (g === 'members') return { get: async () => snap(extra.members ?? []) };
      throw new Error(`unexpected group ${g}`);
    },
    collection: (c: string) => {
      if (c === 'levels') return { get: async () => snap(levels) };
      if (c === 'families') {
        return { get: async () => ({ docs: families.map((f) => ({ id: f.id, data: () => ({ legacyFid: f.legacyFid ?? null }) })) }) };
      }
      if (c === 'attendanceEvents') {
        return {
          where: (_field: string, _op: string, value: unknown) => {
            const oids = value as string[];
            const rows = attendance.filter((a) => oids.includes(a.pid));
            return { get: async () => ({ docs: rows.map((a, i) => ({ id: `a${i}`, data: () => a })) }) };
          },
        };
      }
      if (c === 'offerings') {
        return {
          doc: (oid: string) => ({ __kind: 'offeringDoc' as const, oid }),
          get: async () => ({ docs: Object.entries(offerings).map(([oid, o]) => ({ id: oid, data: () => o })) }),
        };
      }
      throw new Error(`unexpected collection ${c}`);
    },
    getAll: async (...refs: Array<{ oid: string }>) =>
      refs.map((r) => ({
        id: r.oid,
        exists: offerings[r.oid] !== undefined,
        data: () => offerings[r.oid],
      })),
  };
}

beforeEach(() => {
  mockFs.mockReset();
  getLegacyPaymentStatus.mockReset();
  getLegacyPaymentStatus.mockResolvedValue('unknown');
});

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

  it('carries the offering location + term on each level row (disambiguation)', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1'], levelSnapshots: { 'F1-1': { levelId: 'l1' } } },
    ], [
      // `id` keys the level doc in this mock's snap() helper (see makeDb).
      { id: 'l1', levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', pid: 'p1' },
    ], {
      offerings: { p1: { location: 'Brampton', termLabel: '2026-27' } },
    }) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    const l1 = r.byLevel.find((l) => l.levelId === 'l1')!;
    expect(l1.location).toBe('Brampton');
    expect(l1.termLabel).toBe('2026-27');
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

  it('year filter excludes enrollments from other school years (in-memory)', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', termLabel: '2025-26', enrolledMids: ['F1-1'], levelSnapshots: {} },
      { fid: 'F2', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', termLabel: '2024-25', enrolledMids: ['F2-1'], levelSnapshots: {} },
    ], []) as never);

    const r = await buildEnrollmentReport({ format: 'json', year: '2025-26' });
    expect(r.totalActiveEnrollments).toBe(1); // only F1 (2024-25 F2 excluded)
    expect(r.byProgram.find((p) => p.programKey === 'bala-vihar')!.families).toBe(1);
    expect(r.totalMembers).toBe(1); // only F1-1
  });

  it('no year param ⇒ unscoped (counts every active enrollment regardless of term)', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', termLabel: '2025-26', enrolledMids: ['F1-1'], levelSnapshots: {} },
      { fid: 'F2', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', termLabel: '2024-25', enrolledMids: ['F2-1'], levelSnapshots: {} },
    ], []) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    expect(r.totalActiveEnrollments).toBe(2); // both years counted
  });

  it('splits the bala-vihar group into confirmed vs registered (confirmed + registered === families)', async () => {
    // F1 confirmed via a completed donation for its eid; F2 confirmed via teacher
    // attendance (present) on its offering; F3 registered (active BV, no signal);
    // Tabla group (F4) never gets a confirmed/registered split.
    mockFs.mockReturnValue(makeDb(
      [
        { fid: 'F1', eid: 'F1-bv', oid: 'off-bv', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1'], levelSnapshots: {} },
        { fid: 'F2', eid: 'F2-bv', oid: 'off-bv', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: {} },
        { fid: 'F3', eid: 'F3-bv', oid: 'off-bv', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F3-1'], levelSnapshots: {} },
        { fid: 'F4', eid: 'F4-tb', oid: 'off-tb', programKey: 'tabla', programLabel: 'Tabla', status: 'active', enrolledMids: ['F4-1'], levelSnapshots: {} },
      ],
      [],
      {
        families: [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }, { id: 'F4' }],
        donations: [{ fid: 'F1', status: 'completed', eid: 'F1-bv', amountCAD: 100 }],
        attendance: [{ pid: 'off-bv', mid: 'F2-1', status: 'present' }],
        offerings: { 'off-bv': { paymentSource: 'portal' }, 'off-tb': { paymentSource: 'portal' } },
      },
    ) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    const bv = r.byProgram.find((p) => p.programKey === 'bala-vihar')!;
    expect(bv.families).toBe(3);
    expect(bv.confirmed).toBe(2);   // F1 (donation) + F2 (attendance)
    expect(bv.registered).toBe(1);  // F3
    expect(bv.confirmed! + bv.registered!).toBe(bv.families);
    // Non-BV group has no split.
    const tabla = r.byProgram.find((p) => p.programKey === 'tabla')!;
    expect(tabla.confirmed).toBeUndefined();
    expect(tabla.registered).toBeUndefined();
  });

  it('counts legacy-paid families as confirmed for a legacy-sourced BV offering', async () => {
    mockFs.mockReturnValue(makeDb(
      [
        { fid: 'F1', eid: 'F1-bv', oid: 'off-legacy', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1'], levelSnapshots: {} },
        { fid: 'F2', eid: 'F2-bv', oid: 'off-legacy', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: {} },
      ],
      [],
      {
        families: [{ id: 'F1', legacyFid: '700' }, { id: 'F2', legacyFid: '701' }],
        offerings: { 'off-legacy': { paymentSource: 'legacy' } },
      },
    ) as never);
    // Only F1's legacy roster row is paid.
    getLegacyPaymentStatus.mockImplementation(async (lf: string) => (lf === '700' ? 'paid' : 'unpaid'));

    const r = await buildEnrollmentReport({ format: 'json' });
    const bv = r.byProgram.find((p) => p.programKey === 'bala-vihar')!;
    expect(bv.confirmed).toBe(1);   // F1 legacy-paid
    expect(bv.registered).toBe(1);  // F2 not paid
  });
});

describe('buildEnrollmentReport - per-level counts without a levelSnapshot', () => {
  // Production, 2026-08-05: 18 active Bala Vihar enrollments, ZERO with a
  // levelSnapshots entry - only the annual rollover writes that field, and no
  // family has been through one yet. So every per-level row on /welcome/reports
  // read 0 while the roster showed the same children in real classes.
  it('derives the level from the child when the enrollment carries no snapshot', async () => {
    mockFs.mockReturnValue(makeDb(
      [
        {
          fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active',
          pid: 'off-bv', enrolledMids: ['F1-1', 'F1-2'], levelSnapshots: {},
        },
      ],
      [
        { id: 'l2', pid: 'off-bv', levelName: 'Level 2', levelKind: 'level', programKey: 'bala-vihar', gradeBand: ['2', '3'] },
        { id: 'lS', pid: 'off-bv', levelName: 'Shishu Vihar', levelKind: 'shishu', programKey: 'bala-vihar', gradeBand: [] },
      ],
      {
        members: [
          { mid: 'F1-1', type: 'Child', schoolGrade: '2' },
          // Shishu is matched by AGE, never by grade band - 30 months old.
          { mid: 'F1-2', type: 'Child', schoolGrade: 'Shishu', birthMonthYear: shishuAgedBirthMonth() },
        ],
      },
    ) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    expect(r.byLevel.find((l) => l.levelId === 'l2')!.members).toBe(1);
    expect(r.byLevel.find((l) => l.levelId === 'lS')!.members).toBe(1);
  });

  it('PREFERS a stored snapshot over the live derivation (a shape today\'s writers cannot produce)', async () => {
    // Precedence, not live behaviour. `promote-families` is the only writer of
    // levelSnapshots and it cancels the enrollment in the same transaction, so
    // an ACTIVE enrollment with a snapshot - what this fixture builds - cannot
    // currently exist. The branch is guarded here so that if the rollover model
    // ever leaves the source enrollment active, the report keeps reporting
    // where a child ACTUALLY sat rather than re-filing them by this year's
    // grade. The fixture makes snapshot and live grade disagree on purpose.
    mockFs.mockReturnValue(makeDb(
      [
        {
          fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active',
          pid: 'off-bv', enrolledMids: ['F1-1'], levelSnapshots: { 'F1-1': { levelId: 'l2' } },
        },
      ],
      [
        { id: 'l2', pid: 'off-bv', levelName: 'Level 2', levelKind: 'level', programKey: 'bala-vihar', gradeBand: ['2'] },
        { id: 'l5', pid: 'off-bv', levelName: 'Level 5', levelKind: 'level', programKey: 'bala-vihar', gradeBand: ['8'] },
      ],
      { members: [{ mid: 'F1-1', type: 'Child', schoolGrade: '8' }] },
    ) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    expect(r.byLevel.find((l) => l.levelId === 'l2')!.members).toBe(1);
    expect(r.byLevel.find((l) => l.levelId === 'l5')?.members ?? 0).toBe(0);
  });
});

/** A birthMonthYear 30 months back - inside the 18..60 month shishu window. */
function shishuAgedBirthMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 30, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
