import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mutable state the Firestore + getProgram mocks read from.
const state = vi.hoisted(() => ({
  members: [] as Array<{ mid: string; type: 'Adult' | 'Child'; birthMonthYear?: string | null }>,
  enrollments: [] as Array<{ eid: string; programKey: string; status: string; enrolledMids: string[] }>,
  programs: {} as Record<string, { status: string; eligibility: unknown } | null>,
  updates: [] as Array<{ eid: string; enrolledMids: string[] }>,
  commits: 0,
}));

vi.mock('@/features/setu/programs/get-programs', () => ({
  getProgram: vi.fn(async (key: string) => state.programs[key] ?? null),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const membersCol = { get: async () => ({ docs: state.members.map((m) => ({ id: m.mid, data: () => m })) }) };
  const enrollmentsWhere = {
    get: async () => {
      const docs = state.enrollments
        .filter((e) => e.status === 'active')
        .map((e) => ({ id: e.eid, ref: { _eid: e.eid }, data: () => e }));
      return { empty: docs.length === 0, docs };
    },
  };
  const enrollmentsCol = { where: () => enrollmentsWhere };
  const familyDoc = { collection: (name: string) => (name === 'members' ? membersCol : enrollmentsCol) };
  const familiesCol = { doc: () => familyDoc };
  const batch = {
    update: (ref: { _eid: string }, patch: { enrolledMids: string[] }) => {
      state.updates.push({ eid: ref._eid, enrolledMids: patch.enrolledMids });
    },
    commit: async () => { state.commits++; },
  };
  return {
    portalFirestore: () => ({
      collection: (name: string) => (name === 'families' ? familiesCol : { doc: () => ({}) }),
      batch: () => batch,
    }),
  };
});

import { syncActiveEnrollmentMemberships } from '../sync-enrollment-members';

const BV = { status: 'active', eligibility: { memberType: 'child', minAgeYears: null, maxAgeYears: null } };

beforeEach(() => {
  state.members = [];
  state.enrollments = [];
  state.programs = {};
  state.updates = [];
  state.commits = 0;
});

describe('syncActiveEnrollmentMemberships', () => {
  it('adds a child that was added AFTER the family enrolled (the N=2 dashboard bug)', async () => {
    state.programs = { 'bala-vihar': BV };
    state.members = [
      { mid: 'F-01', type: 'Adult' },
      { mid: 'F-02', type: 'Child', birthMonthYear: null },
      { mid: 'F-03', type: 'Child', birthMonthYear: null }, // added later
    ];
    state.enrollments = [{ eid: 'F-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: ['F-02'] }];

    const res = await syncActiveEnrollmentMemberships('F');

    expect(res.updated).toEqual(['F-bv']);
    expect(state.updates).toEqual([{ eid: 'F-bv', enrolledMids: ['F-02', 'F-03'] }]);
    expect(state.commits).toBe(1);
  });

  it('excludes adults from a child-only (Bala Vihar) enrollment', async () => {
    state.programs = { 'bala-vihar': BV };
    state.members = [
      { mid: 'F-01', type: 'Adult' },
      { mid: 'F-02', type: 'Child', birthMonthYear: null },
    ];
    state.enrollments = [{ eid: 'F-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: [] }];

    const res = await syncActiveEnrollmentMemberships('F');

    expect(state.updates).toEqual([{ eid: 'F-bv', enrolledMids: ['F-02'] }]);
    expect(res.updated).toEqual(['F-bv']);
  });

  it('is a no-op when the family has no active enrollment', async () => {
    state.programs = { 'bala-vihar': BV };
    state.members = [{ mid: 'F-02', type: 'Child', birthMonthYear: null }];
    state.enrollments = [{ eid: 'F-bv', programKey: 'bala-vihar', status: 'cancelled', enrolledMids: [] }];

    const res = await syncActiveEnrollmentMemberships('F');

    expect(res.updated).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.commits).toBe(0);
  });

  it('writes nothing when enrolledMids already matches the eligible set', async () => {
    state.programs = { 'bala-vihar': BV };
    state.members = [
      { mid: 'F-01', type: 'Adult' },
      { mid: 'F-02', type: 'Child', birthMonthYear: null },
      { mid: 'F-03', type: 'Child', birthMonthYear: null },
    ];
    // Same set, different order — must NOT trigger a write.
    state.enrollments = [{ eid: 'F-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: ['F-03', 'F-02'] }];

    const res = await syncActiveEnrollmentMemberships('F');

    expect(res.updated).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.commits).toBe(0);
  });

  it('drops a member who no longer exists (deleted child)', async () => {
    state.programs = { 'bala-vihar': BV };
    state.members = [
      { mid: 'F-01', type: 'Adult' },
      { mid: 'F-02', type: 'Child', birthMonthYear: null },
    ];
    state.enrollments = [{ eid: 'F-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: ['F-02', 'F-03'] }];

    await syncActiveEnrollmentMemberships('F');

    expect(state.updates).toEqual([{ eid: 'F-bv', enrolledMids: ['F-02'] }]);
  });

  it('leaves an enrollment untouched when its program is not active', async () => {
    state.programs = { 'bala-vihar': { status: 'draft', eligibility: BV.eligibility } };
    state.members = [{ mid: 'F-02', type: 'Child', birthMonthYear: null }];
    state.enrollments = [{ eid: 'F-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: [] }];

    const res = await syncActiveEnrollmentMemberships('F');

    expect(res.updated).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it('reconciles multiple active enrollments in a single batch', async () => {
    state.programs = { 'bala-vihar': BV, tabla: { status: 'active', eligibility: BV.eligibility } };
    state.members = [
      { mid: 'F-01', type: 'Adult' },
      { mid: 'F-02', type: 'Child', birthMonthYear: null },
      { mid: 'F-03', type: 'Child', birthMonthYear: null },
    ];
    state.enrollments = [
      { eid: 'F-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: ['F-02'] },
      { eid: 'F-tabla', programKey: 'tabla', status: 'active', enrolledMids: ['F-02'] },
    ];

    const res = await syncActiveEnrollmentMemberships('F');

    expect(res.updated).toEqual(['F-bv', 'F-tabla']);
    expect(state.updates).toEqual([
      { eid: 'F-bv', enrolledMids: ['F-02', 'F-03'] },
      { eid: 'F-tabla', enrolledMids: ['F-02', 'F-03'] },
    ]);
    expect(state.commits).toBe(1); // one batch for all changes
  });
});
