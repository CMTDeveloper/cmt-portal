import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemberDoc, FamilyDoc } from '@cmt/shared-domain/setu';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import type { OpenOffering } from '@/features/setu/enrollment/get-open-offerings';

// vi.mock is hoisted above module-level consts, so the mock fns live in a
// vi.hoisted() block (the repo's established seam - see
// check-in/__tests__/auto-enroll-bala-vihar.test.ts).
const {
  getOpenOfferingsForFamily,
  getEnrollments,
  getDonations,
  getLegacyPaymentStatus,
  isTeacherAssigned,
  getFamilyPledge,
} = vi.hoisted(() => ({
  getOpenOfferingsForFamily: vi.fn(),
  getEnrollments: vi.fn(),
  getDonations: vi.fn(),
  getLegacyPaymentStatus: vi.fn(),
  isTeacherAssigned: vi.fn(),
  // Defaults to "no pledge" so every existing case keeps its meaning; the
  // pledge-specific cases opt in.
  getFamilyPledge: vi.fn().mockResolvedValue(null),
}));
// Only the QUERY is mocked - `resolveCurrentOffering` stays real, so the loader
// is exercised against the actual tie-break rule (which has its own tests in
// enrollment/__tests__/get-open-offerings.test.ts) rather than a stub of it.
vi.mock('@/features/setu/enrollment/get-open-offerings', async (orig) => ({
  ...(await orig<typeof import('@/features/setu/enrollment/get-open-offerings')>()),
  getOpenOfferingsForFamily,
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
vi.mock('@/features/setu/donations/get-donations', () => ({ getDonations }));
vi.mock('@/features/setu/donations/legacy-payment', () => ({ getLegacyPaymentStatus }));
vi.mock('@/features/setu/teacher/assignments', () => ({ isTeacherAssigned }));
vi.mock('@/features/setu/pledges/get-family-pledge', () => ({ getFamilyPledge }));

import { loadAdultClassGateDataOrThrow, loadAdultClassGateDataFailSoft } from '../load-gate-data';

const BV_OID = 'bala-vihar-brampton-2026-27';

function offering(over: Partial<OpenOffering> & { oid: string }): OpenOffering {
  return {
    programKey: 'adult-study-class',
    location: 'Brampton',
    startDate: new Date('2026-09-13T00:00:00Z'),
    endDate: null,
    enabled: true,
    ...over,
  } as unknown as OpenOffering;
}

function adult(mid: string, over: Partial<MemberDoc> = {}): MemberDoc {
  return { mid, firstName: 'A', lastName: 'Parent', type: 'Adult', ...over } as MemberDoc;
}
function child(mid: string, over: Partial<MemberDoc> = {}): MemberDoc {
  return { mid, firstName: 'C', lastName: 'Kid', type: 'Child', ...over } as MemberDoc;
}

function family(over: Partial<FamilyDoc> = {}): FamilyDoc {
  return { fid: 'CMT-F', name: 'Parent', location: 'Brampton', legacyFid: '1075', ...over } as FamilyDoc;
}

function bvEnrollment(over: Partial<EnrollmentWithOffering> = {}): EnrollmentWithOffering {
  return {
    eid: `CMT-F-${BV_OID}`,
    fid: 'CMT-F',
    oid: BV_OID,
    programKey: 'bala-vihar',
    status: 'active',
    enrolledMids: ['CMT-F-03'],
    effectiveSuggestedAmount: 500,
    offering: { oid: BV_OID, paymentSource: 'portal' },
    ...over,
  } as unknown as EnrollmentWithOffering;
}

beforeEach(() => {
  getOpenOfferingsForFamily.mockReset().mockResolvedValue([offering({ oid: 'asc-2026' })]);
  getEnrollments.mockReset().mockResolvedValue([bvEnrollment()]);
  getDonations.mockReset().mockResolvedValue([]);
  getLegacyPaymentStatus.mockReset().mockResolvedValue('paid');
  isTeacherAssigned.mockReset().mockResolvedValue(false);
});

// ───────────────────────────────────────────────────────────────────────────
// loadAdultClassGateDataOrThrow - the I/O half
// ───────────────────────────────────────────────────────────────────────────
describe('loadAdultClassGateDataOrThrow', () => {
  it('assembles every field the predicate needs for a gated family', async () => {
    const members = [adult('CMT-F-01'), adult('CMT-F-02'), child('CMT-F-03')];
    getDonations.mockResolvedValue([{ status: 'completed', eid: `CMT-F-${BV_OID}`, amountCAD: 500 }]);

    const data = await loadAdultClassGateDataOrThrow({ family: family(), members, isManager: true });

    expect(getOpenOfferingsForFamily).toHaveBeenCalledWith('adult-study-class', 'Brampton');
    expect(data).not.toBeNull();
    expect(data!.isManager).toBe(true);
    expect(data!.members).toEqual(members);
    expect(data!.currentOffering?.oid).toBe('asc-2026');
    expect(data!.enrollments).toHaveLength(1);
    expect(data!.donations).toEqual([{ status: 'completed', eid: `CMT-F-${BV_OID}`, amountCAD: 500 }]);
    expect(data!.teacherAssignedMids).toEqual(new Set());
  });

  // ── Cheap exits: these run on EVERY /family/* render, so a family that can
  //    never be gated must cost zero Firestore reads. ──────────────────────
  it('returns null for a non-manager without issuing a single read', async () => {
    const r = await loadAdultClassGateDataOrThrow({
      family: family(),
      members: [adult('CMT-F-01')],
      isManager: false,
    });
    expect(r).toBeNull();
    expect(getOpenOfferingsForFamily).not.toHaveBeenCalled();
    expect(getEnrollments).not.toHaveBeenCalled();
    expect(getDonations).not.toHaveBeenCalled();
    expect(isTeacherAssigned).not.toHaveBeenCalled();
  });

  it('returns null without a read when no adult could ever be selected', async () => {
    const r = await loadAdultClassGateDataOrThrow({
      family: family(),
      members: [child('CMT-F-03'), adult('CMT-F-02', { inviteStatus: 'pending' })],
      isManager: true,
    });
    expect(r).toBeNull();
    expect(getOpenOfferingsForFamily).not.toHaveBeenCalled();
    expect(isTeacherAssigned).not.toHaveBeenCalled();
  });

  it('stops after the offering query when no adult-class offering is open', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([]);
    const r = await loadAdultClassGateDataOrThrow({
      family: family(),
      members: [adult('CMT-F-01')],
      isManager: true,
    });
    expect(r).toBeNull();
    expect(getEnrollments).not.toHaveBeenCalled();
    expect(getDonations).not.toHaveBeenCalled();
    expect(isTeacherAssigned).not.toHaveBeenCalled();
  });

  // ── Condition 5's set RESOLUTION. selectableAdults takes this set as INPUT,
  //    so every predicate test stays green if the loader resolves it over the
  //    wrong people. This is the only place that is checked. ───────────────
  describe('teacherAssignedMids resolution', () => {
    it('is keyed by mid and contains exactly the assigned adults', async () => {
      isTeacherAssigned.mockImplementation(async (ref: string) => ref === 'CMT-F-02');
      const data = await loadAdultClassGateDataOrThrow({
        family: family(),
        members: [adult('CMT-F-01'), adult('CMT-F-02')],
        isManager: true,
      });
      expect(data!.teacherAssignedMids).toEqual(new Set(['CMT-F-02']));
    });

    it('never asks about a CHILD - teacherAssignments/{mid} is an adult concept', async () => {
      await loadAdultClassGateDataOrThrow({
        family: family(),
        members: [adult('CMT-F-01'), child('CMT-F-03')],
        isManager: true,
      });
      const asked = isTeacherAssigned.mock.calls.map((c) => c[0]);
      expect(asked).toEqual(['CMT-F-01']);
    });

    it('never asks about a pending invitee - one doc read per adult is the cost here', async () => {
      await loadAdultClassGateDataOrThrow({
        family: family(),
        members: [adult('CMT-F-01'), adult('CMT-F-02', { inviteStatus: 'pending' })],
        isManager: true,
      });
      expect(isTeacherAssigned.mock.calls.map((c) => c[0])).toEqual(['CMT-F-01']);
    });
  });

  // ── A family whose doc has no `location`. get-family-by-fid.ts:31 maps it
  //    with NO fallback, so `location` is `undefined` at runtime however
  //    FamilyDocSchema types it, and getOpenOfferingsForFamily then takes the
  //    single-query (location-less only) branch. ───────────────────────────
  it('passes null - never undefined - when the family has no location', async () => {
    await loadAdultClassGateDataOrThrow({
      family: family({ location: undefined as unknown as string }),
      members: [adult('CMT-F-01')],
      isManager: true,
    });
    expect(getOpenOfferingsForFamily).toHaveBeenCalledWith('adult-study-class', null);
  });

  // ── The legacy leg. getLegacyPaymentStatus reads the WHOLE prod RTDB roster;
  //    it only means anything when the BV offering is legacy-sourced. ──────
  it('skips the whole-roster RTDB read when the BV offering is not legacy-sourced', async () => {
    const data = await loadAdultClassGateDataOrThrow({
      family: family(),
      members: [adult('CMT-F-01')],
      isManager: true,
    });
    expect(getLegacyPaymentStatus).not.toHaveBeenCalled();
    expect(data!.legacyPaymentStatus).toBe('unknown');
  });

  it('reads and passes through the legacy status for a legacy-sourced BV offering', async () => {
    getEnrollments.mockResolvedValue([
      bvEnrollment({ offering: { oid: BV_OID, paymentSource: 'legacy' } as never }),
    ]);
    const data = await loadAdultClassGateDataOrThrow({
      family: family(),
      members: [adult('CMT-F-01')],
      isManager: true,
    });
    expect(getLegacyPaymentStatus).toHaveBeenCalledWith('1075');
    expect(data!.legacyPaymentStatus).toBe('paid');
  });

  // ── Read failures THROW here. Folding them into `null` would make a screen
  //    that renders indistinguishable from one that has nothing to show - see
  //    the fail-soft variant below. ──────────────────────────────────────────
  it('throws when a read fails, rather than reporting "nothing to ask"', async () => {
    getEnrollments.mockRejectedValue(new Error('FAILED_PRECONDITION: index'));
    await expect(
      loadAdultClassGateDataOrThrow({ family: family(), members: [adult('CMT-F-01')], isManager: true }),
    ).rejects.toThrow('FAILED_PRECONDITION');
  });
});

// ── The gate's variant. This gate REDIRECTS and runs on every /family/* render,
//    so a transient read failure must cost an un-asked question, not a 500 on
//    the whole portal. The SCREEN the gate redirects to must not use this, or an
//    intermittent failure ping-pongs the two routes. ────────────────────────
describe('loadAdultClassGateDataFailSoft', () => {
  it('returns null instead of throwing when a read fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getEnrollments.mockRejectedValue(new Error('FAILED_PRECONDITION: index'));
    const r = await loadAdultClassGateDataFailSoft({
      family: family(),
      members: [adult('CMT-F-01')],
      isManager: true,
    });
    expect(r).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('passes a successful load straight through', async () => {
    const data = await loadAdultClassGateDataFailSoft({
      family: family(),
      members: [adult('CMT-F-01')],
      isManager: true,
    });
    expect(data?.currentOffering?.oid).toBe('asc-2026');
  });
});
