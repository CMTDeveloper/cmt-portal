import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Direct unit tests for `enrollFamily` - the single function behind the door
 * kiosk, teacher first-attendance enrollment, family self-serve, and staff
 * enroll. Deliberately NOT added to enrollment-integration.test.ts: that file
 * drives enrollFamily through the routes and several of its describe blocks use
 * persistent `mockResolvedValue`s that leak state across tests.
 */

// ensurePublicFid runs AFTER the txn commits; stub it (own test covers it).
vi.mock('../ensure-public-fid', () => ({ ensurePublicFid: vi.fn().mockResolvedValue('5001') }));

const mockGetProgram = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/programs/get-programs', () => ({
  getProgram: (...a: unknown[]) => mockGetProgram(...a),
}));

// Refs are tagged so the fake txn can dispatch reads by identity.
type Tagged = { __kind: 'offering' | 'enrollment' | 'family' | 'members' };
const refs: Record<string, Tagged> = {
  offering: { __kind: 'offering' },
  enrollment: { __kind: 'enrollment' },
  family: { __kind: 'family' },
  members: { __kind: 'members' },
};

const state = {
  offering: null as Record<string, unknown> | null,
  enrollment: null as Record<string, unknown> | null,
  family: {} as Record<string, unknown> | null,
  members: [] as Record<string, unknown>[],
};

const sets: { ref: Tagged; data: Record<string, unknown> }[] = [];
const updates: { ref: Tagged; data: Record<string, unknown> }[] = [];

const mockRunTransaction = vi.hoisted(() => vi.fn());

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  portalFirestore: () => ({
    runTransaction: mockRunTransaction,
    collection: (name: string) => {
      if (name === 'offerings') return { doc: () => refs.offering };
      // families
      return {
        doc: () => ({
          ...refs.family,
          collection: (sub: string) =>
            sub === 'enrollments'
              ? { doc: () => refs.enrollment }
              : refs.members,
        }),
      };
    },
  }),
}));

import { enrollFamily } from '../enroll-family';

const FID = 'CMT-FAM1';
const OID = 'adult-study-class-2026-27';
const EID = `${FID}-${OID}`;

function snapFor(ref: Tagged) {
  switch (ref.__kind) {
    case 'offering':
      return state.offering
        ? { exists: true, data: () => state.offering }
        : { exists: false, data: () => undefined };
    case 'enrollment':
      return state.enrollment
        ? { exists: true, data: () => state.enrollment }
        : { exists: false, data: () => undefined };
    case 'family':
      return state.family
        ? { exists: true, data: () => state.family }
        : { exists: false, data: () => undefined };
    case 'members':
      return { docs: state.members.map((m) => ({ data: () => m })) };
  }
}

const base = { fid: FID, oid: OID, enrolledVia: 'family-initiated' as const, enrolledByMid: `${FID}-01` };

function adult(mid: string): Record<string, unknown> {
  return { mid, type: 'Adult', birthMonthYear: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  sets.length = 0;
  updates.length = 0;
  state.offering = {
    enabled: true,
    startDate: new Date('2026-09-01'),
    endDate: null,
    pricingTiers: [{ amountCAD: 101, from: null }],
    programKey: 'adult-study-class',
    programLabel: 'Adult Study Class',
    termLabel: '2026-27',
    location: 'Brampton',
  };
  state.enrollment = null;
  state.family = { fid: FID };
  state.members = [adult(`${FID}-01`), adult(`${FID}-02`), adult(`${FID}-03`)];

  mockGetProgram.mockResolvedValue({
    programKey: 'adult-study-class',
    status: 'active',
    eligibility: { memberType: 'adult' },
  });

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) =>
    fn({
      get: async (ref: Tagged) => snapFor(ref),
      set: (ref: Tagged, data: Record<string, unknown>) => { sets.push({ ref, data }); },
      update: (ref: Tagged, data: Record<string, unknown>) => { updates.push({ ref, data }); },
    }),
  );
});

function writtenEnrollment(): Record<string, unknown> {
  const hit = sets.find((s) => s.ref.__kind === 'enrollment');
  if (!hit) throw new Error('no enrollment doc was written');
  return hit.data;
}

describe('enrollFamily - explicit member selection', () => {
  it('enrolls exactly the supplied mids, not every eligible member', async () => {
    // Three eligible adults on the family; the caller names ONE. Without this,
    // the Adult Study Class would silently enroll every adult in the household -
    // including the one running a class that hour.
    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-02`] });

    expect(res.created).toBe(true);
    expect(writtenEnrollment().enrolledMids).toEqual([`${FID}-02`]);
  });

  it('still derives from eligibility when no mids are supplied', async () => {
    await enrollFamily(base);
    expect(writtenEnrollment().enrolledMids).toEqual([`${FID}-01`, `${FID}-02`, `${FID}-03`]);
  });

  it('applies the no-eligible-members guard to the SUPPLIED list', async () => {
    // enroll-family refuses to create an empty enrollment when it DERIVES the
    // list; the same invariant must hold for an explicitly supplied empty one,
    // or a caller can write a meaningless enrollment that nonetheless satisfies
    // the adult-class gate's "has an active enrollment" condition.
    await expect(enrollFamily({ ...base, enrolledMids: [] })).rejects.toThrow('no-eligible-members');
    expect(sets).toHaveLength(0);
  });
});

describe('enrollFamily - suggestedAmountOverride', () => {
  it('persists an override of 0 when supplied', async () => {
    // The Bala-Vihar-paid exemption. `0` must reach the doc as a literal zero,
    // not be treated as "nothing supplied".
    await enrollFamily({ ...base, suggestedAmountOverride: 0 });
    expect(writtenEnrollment().suggestedAmountOverride).toBe(0);
  });

  it('persists a positive override when supplied', async () => {
    await enrollFamily({ ...base, suggestedAmountOverride: 250 });
    expect(writtenEnrollment().suggestedAmountOverride).toBe(250);
  });

  it('writes null when not supplied', async () => {
    await enrollFamily(base);
    expect(writtenEnrollment().suggestedAmountOverride).toBeNull();
  });

  it('does NOT let an override move the pinned snapshot', async () => {
    // suggestedAmountSnapshot is pinned from the offering at enroll time so a
    // later tier edit cannot move it. The override is a separate field.
    await enrollFamily({ ...base, suggestedAmountOverride: 0 });
    expect(writtenEnrollment().suggestedAmountSnapshot).toBe(101);
  });
});

describe('enrollFamily - membershipMode', () => {
  it('persists manual when supplied', async () => {
    await enrollFamily({ ...base, membershipMode: 'manual' });
    expect(writtenEnrollment().membershipMode).toBe('manual');
  });

  it("defaults to 'auto' so every existing caller keeps today's semantics", async () => {
    await enrollFamily(base);
    expect(writtenEnrollment().membershipMode).toBe('auto');
  });
});

describe('enrollFamily - existing callers are unaffected', () => {
  // THE PROOF OBLIGATION. Four callers pass exactly the original four params:
  // the door kiosk (auto-enroll-bala-vihar.ts:24, every Sunday morning), teacher
  // first-attendance (enroll-on-first-attendance.ts:20), family self-serve
  // (api/setu/enrollments/route.ts:56) and staff enroll
  // (api/welcome/enrollments/route.ts:34). If this shape changes for them, the
  // kiosk breaks at the door.
  it('writes exactly the same enrollment doc shape as before for a 4-param call', async () => {
    await enrollFamily(base);

    const doc = writtenEnrollment();
    expect(doc).toEqual({
      eid: EID,
      fid: FID,
      oid: OID,
      pid: OID,
      programKey: 'adult-study-class',
      programLabel: 'Adult Study Class',
      termLabel: '2026-27',
      location: 'Brampton',
      enrolledAt: 'SERVER_TIMESTAMP',
      enrolledVia: 'family-initiated',
      enrolledByMid: `${FID}-01`,
      enrolledMids: [`${FID}-01`, `${FID}-02`, `${FID}-03`],
      suggestedAmountSnapshot: 101,
      suggestedAmountOverride: null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
      // The ONLY addition for an unchanged caller. 'auto' is what absence has
      // always meant, so this is a no-op in behaviour.
      membershipMode: 'auto',
    });
  });

  it('still no-ops on an already-active enrollment when no new param is supplied', async () => {
    // The kiosk's documented idempotency (auto-enroll-bala-vihar.ts:13) rests on
    // this exact behaviour: re-enrolling an active family writes NOTHING.
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77 };

    const res = await enrollFamily(base);

    expect(res).toEqual({ created: false, eid: EID, suggestedAmountSnapshot: 77 });
    expect(sets).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
