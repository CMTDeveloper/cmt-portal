import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mutable state the Firestore + getProgram mocks read from.
const state = vi.hoisted(() => ({
  members: [] as Array<{ mid: string; type: 'Adult' | 'Child'; birthMonthYear?: string | null }>,
  enrollments: [] as Array<{ eid: string; programKey: string; status: string; enrolledMids: string[]; membershipMode?: 'auto' | 'manual' }>,
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

// ── membershipMode: a family's explicit choice must survive a member edit ────
// The Adult Study Class lets a family name WHICH non-teaching adult attends.
// Without this the prune re-derives every eligible adult on the next member
// edit - re-enrolling the parent who is teaching that hour, and silently
// overwriting a choice the family made deliberately.
describe('syncActiveEnrollmentMemberships - membershipMode', () => {
  const ASC = { status: 'active', eligibility: { memberType: 'adult', minAgeYears: null, maxAgeYears: null } };

  beforeEach(() => {
    state.programs = { 'adult-study-class': ASC };
    state.members = [
      { mid: 'f-01', type: 'Adult' },
      { mid: 'f-02', type: 'Adult' },
      { mid: 'f-03', type: 'Adult' },
    ];
  });

  it('does NOT re-derive a MANUAL enrollment when an unrelated member is edited', async () => {
    // The family chose f-02 alone. Editing anyone must not re-add f-01 and f-03.
    state.enrollments = [{
      eid: 'e-asc', programKey: 'adult-study-class', status: 'active',
      enrolledMids: ['f-02'], membershipMode: 'manual',
    }];

    const res = await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toHaveLength(0);
    expect(res.updated).toEqual([]);
  });

  it('still re-derives an AUTO enrollment (today\'s behaviour, unchanged)', async () => {
    state.enrollments = [{
      eid: 'e-asc', programKey: 'adult-study-class', status: 'active',
      enrolledMids: ['f-02'], membershipMode: 'auto',
    }];

    await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toEqual([{ eid: 'e-asc', enrolledMids: ['f-01', 'f-02', 'f-03'] }]);
  });

  it('treats an ABSENT membershipMode as auto - every pre-existing enrollment', async () => {
    state.enrollments = [{
      eid: 'e-asc', programKey: 'adult-study-class', status: 'active',
      enrolledMids: ['f-02'],
    }];

    await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toEqual([{ eid: 'e-asc', enrolledMids: ['f-01', 'f-02', 'f-03'] }]);
  });

  it('DROPS a departed member even from a MANUAL enrollment', async () => {
    // This drop is load-bearing: an emptied list is exactly what makes the
    // adult-class gate re-fire so the family is asked to choose again.
    state.members = [{ mid: 'f-01', type: 'Adult' }, { mid: 'f-03', type: 'Adult' }];
    state.enrollments = [{
      eid: 'e-asc', programKey: 'adult-study-class', status: 'active',
      enrolledMids: ['f-02'], membershipMode: 'manual',
    }];

    await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toEqual([{ eid: 'e-asc', enrolledMids: [] }]);
  });

  it('drops ONLY the departed member, keeping the rest of a manual selection', async () => {
    state.members = [{ mid: 'f-01', type: 'Adult' }, { mid: 'f-03', type: 'Adult' }];
    state.enrollments = [{
      eid: 'e-asc', programKey: 'adult-study-class', status: 'active',
      enrolledMids: ['f-01', 'f-02'], membershipMode: 'manual',
    }];

    await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toEqual([{ eid: 'e-asc', enrolledMids: ['f-01'] }]);
  });

  it('does NOT drop a manually-chosen member who merely became INELIGIBLE', async () => {
    // Existence, not eligibility. memberEligibleForProgram can depend on age and
    // therefore on the clock, so an eligibility-filtered manual list could empty
    // itself on a date boundary with no user action - the gate would re-fire and
    // the family would be asked to re-choose for no reason. A mis-typed member
    // staying enrolled is the far milder failure, and it is visible and fixable.
    state.members = [{ mid: 'f-01', type: 'Adult' }, { mid: 'f-02', type: 'Child' }, { mid: 'f-03', type: 'Adult' }];
    state.enrollments = [{
      eid: 'e-asc', programKey: 'adult-study-class', status: 'active',
      enrolledMids: ['f-02'], membershipMode: 'manual',
    }];

    await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toHaveLength(0);
  });

  it('leaves a MANUAL enrollment alone while still syncing an AUTO one beside it', async () => {
    // N=2: a real family has Bala Vihar (auto) AND the adult class (manual).
    // A single-enrollment fixture would never catch a mode check applied
    // per-family instead of per-enrollment.
    state.programs = { 'adult-study-class': ASC, 'bala-vihar': BV };
    state.members = [
      { mid: 'f-01', type: 'Adult' }, { mid: 'f-02', type: 'Adult' },
      { mid: 'f-04', type: 'Child', birthMonthYear: '2016-05' },
    ];
    state.enrollments = [
      { eid: 'e-asc', programKey: 'adult-study-class', status: 'active', enrolledMids: ['f-02'], membershipMode: 'manual' },
      { eid: 'e-bv', programKey: 'bala-vihar', status: 'active', enrolledMids: [] },
    ];

    await syncActiveEnrollmentMemberships('f');

    expect(state.updates).toEqual([{ eid: 'e-bv', enrolledMids: ['f-04'] }]);
  });
});
