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
      set: (ref: Tagged, data: Record<string, unknown>) => {
        sets.push({ ref, data });
        // Reflect the write back into state so a SECOND enrollFamily call in the
        // same test sees the doc it just created - which is what makes the
        // reconcile path testable at all.
        if (ref.__kind === 'enrollment') state.enrollment = { ...data };
      },
      update: (ref: Tagged, data: Record<string, unknown>) => {
        updates.push({ ref, data });
        if (ref.__kind === 'enrollment') state.enrollment = { ...state.enrollment, ...data };
      },
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

// ── Task 3: reconcile an existing ACTIVE enrollment ──────────────────────────
// Without this the family is locked out of the portal permanently. eid is
// deterministic, so a re-enroll hits the already-active branch. The sequence:
// the selected parent leaves -> the member-edit prune empties enrolledMids ->
// the adult-class gate fires (an empty list must re-fire) -> the family picks
// someone -> POST 200 -> NOTHING is written -> the gate fires again. The manager
// never reaches /family again.
describe('enrollFamily - reconcile on an active enrollment', () => {
  it('a second enroll with different mids updates the existing active enrollment', async () => {
    await enrollFamily({ ...base, enrolledMids: [`${FID}-02`], membershipMode: 'manual' });
    expect(state.enrollment!.enrolledMids).toEqual([`${FID}-02`]);

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`], membershipMode: 'manual' });

    expect(state.enrollment!.enrolledMids).toEqual([`${FID}-03`]);
    expect(res.created).toBe(false);
  });

  it('reports that it reconciled, so callers can tell it apart from a no-op', async () => {
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77 };
    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });
    expect(res).toMatchObject({ created: false, reconciled: true, eid: EID });
  });

  it('NEVER recomputes suggestedAmountSnapshot on reconcile', async () => {
    // The snapshot is pinned at first enrollment by design so a later tier edit
    // cannot move what an already-enrolled family owes. The live offering here
    // is 101; the stored snapshot is 77 and must stay 77.
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77, enrolledMids: [`${FID}-01`] };

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });

    expect(res.suggestedAmountSnapshot).toBe(77);
    const written = updates.find((u) => u.ref.__kind === 'enrollment')!.data;
    expect(written).not.toHaveProperty('suggestedAmountSnapshot');
  });

  it('reconciles an override of 0 onto an existing enrollment', async () => {
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 101, suggestedAmountOverride: null };
    await enrollFamily({ ...base, suggestedAmountOverride: 0 });
    expect(state.enrollment.suggestedAmountOverride).toBe(0);
  });

  it('touches ONLY the fields explicitly supplied', async () => {
    // A reconcile that supplies just the mids must not reset the override or the
    // mode, or picking a different parent would silently re-bill a family whose
    // fee had been waived.
    state.enrollment = {
      status: 'active', suggestedAmountSnapshot: 101,
      suggestedAmountOverride: 0, membershipMode: 'manual', enrolledMids: [`${FID}-01`],
    };

    await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });

    const written = updates.find((u) => u.ref.__kind === 'enrollment')!.data;
    // Assert the DANGEROUS fields are absent rather than pinning an exact key
    // list: `updatedAt` is legitimately added (matching the staff override
    // route), and a key-list assertion would forbid that for no good reason.
    for (const forbidden of [
      'suggestedAmountSnapshot', 'enrolledAt', 'enrolledVia', 'enrolledByMid',
      'pid', 'oid', 'fid', 'eid', 'levelSnapshots', 'status', 'programKey', '_test',
    ]) {
      expect(written).not.toHaveProperty(forbidden);
    }
    expect(written).toHaveProperty('enrolledMids');
    expect(state.enrollment.suggestedAmountOverride).toBe(0);
    expect(state.enrollment.membershipMode).toBe('manual');
  });

  it('does NOT reconcile a CANCELLED enrollment - it re-creates instead', async () => {
    // A cancelled enrollment must go through the full create path (fresh
    // snapshot, fresh enrolledAt, status back to active), not be patched.
    state.enrollment = { status: 'cancelled', suggestedAmountSnapshot: 77 };

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });

    expect(res.created).toBe(true);
    expect(updates).toHaveLength(0);
    expect(writtenEnrollment().status).toBe('active');
    expect(writtenEnrollment().suggestedAmountSnapshot).toBe(101);
  });
});

// ── Reachability + write hygiene (found by an independent audit) ─────────────
describe('enrollFamily - the reconcile must stay reachable', () => {
  // THE WIDEST BLIND SPOT the audit found: every other fixture here sets
  // enabled:true / endDate:null, so a reconcile sitting BELOW the
  // enrollment-window gates would have stayed green forever while being
  // unreachable in production exactly when it is needed.
  it('reconciles even when the offering is DISABLED (registration closed)', async () => {
    state.offering = { ...state.offering, enabled: false };
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77, enrolledMids: [`${FID}-01`] };

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });

    expect(res).toMatchObject({ created: false, reconciled: true });
    expect(state.enrollment.enrolledMids).toEqual([`${FID}-03`]);
  });

  it('reconciles even when the offering has EXPIRED', async () => {
    state.offering = { ...state.offering, endDate: new Date('2020-01-01') };
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77, enrolledMids: [`${FID}-01`] };

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });

    expect(res).toMatchObject({ created: false, reconciled: true });
  });

  it('reconciles even when the PROGRAM is not active', async () => {
    mockGetProgram.mockResolvedValue({ programKey: 'adult-study-class', status: 'archived', eligibility: { memberType: 'adult' } });
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77, enrolledMids: [`${FID}-01`] };

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });

    expect(res).toMatchObject({ created: false, reconciled: true });
  });

  // The window gates must STILL apply to a genuine new enrollment, and to the
  // plain no-op path - existing callers keep their error behaviour exactly.
  it('still refuses to CREATE into a disabled offering', async () => {
    state.offering = { ...state.offering, enabled: false };
    state.enrollment = null;
    await expect(enrollFamily({ ...base, enrolledMids: [`${FID}-03`] })).rejects.toThrow('offering-disabled');
  });

  it('still throws offering-disabled on the plain NO-OP path (nothing supplied)', async () => {
    // Byte-identical to pre-change behaviour for the four existing callers:
    // they supply none of the new params, so they still hit the gates first.
    state.offering = { ...state.offering, enabled: false };
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77 };
    await expect(enrollFamily(base)).rejects.toThrow('offering-disabled');
  });
});

describe('enrollFamily - reconcile write hygiene', () => {
  it('does NOT write when the supplied values already match', async () => {
    // This doc is also targeted by the member-edit prune; a double-submit or
    // client retry must not contend on it for nothing.
    state.enrollment = {
      status: 'active', suggestedAmountSnapshot: 77,
      enrolledMids: [`${FID}-03`], membershipMode: 'manual',
    };

    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`], membershipMode: 'manual' });

    expect(res).toMatchObject({ created: false, reconciled: true });
    expect(updates).toHaveLength(0);
  });

  it('stamps updatedAt, matching what the staff override route writes', async () => {
    state.enrollment = { status: 'active', suggestedAmountSnapshot: 77, enrolledMids: [`${FID}-01`] };
    await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });
    expect(updates[0]!.data).toHaveProperty('updatedAt', 'SERVER_TIMESTAMP');
  });

  it('returns 0 rather than undefined when an older doc lacks the snapshot', async () => {
    // Several writers exist (backfill/seed/rollover scripts); a doc missing the
    // field would otherwise serialise `suggestedAmount: undefined`, which JSON
    // drops entirely - a blank donate CTA, and a required field absent for the
    // mobile client that hand-mirrors this shape.
    state.enrollment = { status: 'active', enrolledMids: [`${FID}-01`] };
    const res = await enrollFamily({ ...base, enrolledMids: [`${FID}-03`] });
    expect(res.suggestedAmountSnapshot).toBe(0);
  });
});
