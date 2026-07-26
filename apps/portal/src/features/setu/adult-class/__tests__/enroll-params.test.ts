import { describe, it, expect } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { resolveAdultClassEnrollParams } from '../enroll-params';

const ASC_OID = 'adult-study-class-2026-27';
const BV_OID = 'bala-vihar-2026-27';

function adult(mid: string, over: Partial<MemberDoc> = {}): MemberDoc {
  return { mid, firstName: 'A', lastName: 'Parent', type: 'Adult', ...over } as MemberDoc;
}
function child(mid: string): MemberDoc {
  return { mid, firstName: 'C', lastName: 'Kid', type: 'Child' } as MemberDoc;
}

function enrollment(over: Partial<EnrollmentWithOffering> & { oid: string; programKey: string }) {
  return {
    eid: `F-${over.oid}`,
    fid: 'F',
    status: 'active',
    enrolledMids: ['F-03'],
    suggestedAmountOverride: null,
    offering: { paymentSource: 'portal' },
    ...over,
  } as unknown as EnrollmentWithOffering;
}

const MEMBERS = [adult('F-01'), adult('F-02'), child('F-09')];

function resolve(over: {
  members?: readonly MemberDoc[];
  enrollments?: EnrollmentWithOffering[];
  teacherAssignedMids?: ReadonlySet<string>;
} = {}) {
  return resolveAdultClassEnrollParams(
    {
      members: over.members ?? MEMBERS,
      enrollments: over.enrollments ?? [],
      teacherAssignedMids: over.teacherAssignedMids ?? new Set(),
    },
    ASC_OID,
  );
}

describe('resolveAdultClassEnrollParams - who gets enrolled', () => {
  // The generic route's whole other half. enroll-family derives from
  // memberEligibleForProgram, which for memberType 'adult' matches EVERY Adult.
  it('enrolls the non-teaching adults, never every Adult', () => {
    const r = resolve({ teacherAssignedMids: new Set(['F-02']) });
    expect(r.enrolledMids).toEqual(['F-01']);
  });

  it('never enrolls a child', () => {
    expect(resolve().enrolledMids).toEqual(['F-01', 'F-02']);
  });

  it('never enrolls a pending invitee', () => {
    const r = resolve({ members: [adult('F-01'), adult('F-02', { inviteStatus: 'pending' })] });
    expect(r.enrolledMids).toEqual(['F-01']);
  });

  // Without this the next member edit re-derives "every adult" over the choice.
  it('always freezes the membership as manual', () => {
    expect(resolve().membershipMode).toBe('manual');
  });
});

describe('resolveAdultClassEnrollParams - the waiver', () => {
  it('waives for a family with an active Bala Vihar enrollment', () => {
    const r = resolve({ enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar' })] });
    expect(r.waiver).toEqual({ suggestedAmountOverride: 0 });
  });

  // A family with no Bala Vihar is not a Bala Vihar family - they pay.
  it('does NOT waive for a family with no Bala Vihar enrollment', () => {
    expect(resolve().waiver).toEqual({ suggestedAmountOverride: null });
  });

  it('does NOT waive on a CANCELLED Bala Vihar enrollment', () => {
    const r = resolve({
      enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar', status: 'cancelled' })],
    });
    expect(r.waiver).toEqual({ suggestedAmountOverride: null });
  });

  // Step 3c, decided: the waiver tracks Bala Vihar MEMBERSHIP, not payment -
  // the opposite of the gate's condition 3, and deliberately so. Blocking on
  // `bvPaid` would inherit its documented false negative (a legacy-paid family
  // whose offering doc is missing reads as unpaid) and turn "never asked",
  // which is benign, into "refused", which is not.
  it('waives even when the Bala Vihar donation has NOT been paid', () => {
    const r = resolve({
      enrollments: [enrollment({ oid: BV_OID, programKey: 'bala-vihar' })], // no donations at all
    });
    expect(r.waiver).toEqual({ suggestedAmountOverride: 0 });
  });

  // The N=2 rule: a second active enrollment must not hijack the BV lookup.
  it('finds Bala Vihar by programKey even alongside another active enrollment', () => {
    const r = resolve({
      enrollments: [
        enrollment({ oid: 'tabla-2026-27', programKey: 'tabla' }),
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
      ],
    });
    expect(r.waiver).toEqual({ suggestedAmountOverride: 0 });
  });
});

describe('resolveAdultClassEnrollParams - create-only (Step 3b)', () => {
  // Enroll childless at $101 -> PAY -> add a child -> enroll Bala Vihar -> pay ->
  // re-POST the adult-class oid. Without this guard the reconcile rewrites the
  // $101 they ALREADY PAID down to an expected of 0. Deviation 1 says retroactive
  // exemption is not implemented.
  it('leaves a stored override alone rather than retroactively zeroing it', () => {
    const r = resolve({
      enrollments: [
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class', suggestedAmountOverride: 101 } as never),
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
      ],
    });
    expect(r.waiver).toBeNull();
  });

  it('leaves a stored override of 0 alone too - it is already settled', () => {
    const r = resolve({
      enrollments: [
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class', suggestedAmountOverride: 0 } as never),
      ],
    });
    expect(r.waiver).toBeNull();
  });

  // A null stored override is "never priced", so the waiver may still apply.
  it('still applies the waiver when the existing enrollment has no override', () => {
    const r = resolve({
      enrollments: [
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class' }),
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
      ],
    });
    expect(r.waiver).toEqual({ suggestedAmountOverride: 0 });
  });

  // A CANCELLED prior enrollment must not block a fresh one from being priced.
  it('ignores a cancelled prior adult-class enrollment when pricing', () => {
    const r = resolve({
      enrollments: [
        enrollment({ oid: ASC_OID, programKey: 'adult-study-class', status: 'cancelled', suggestedAmountOverride: 101 } as never),
        enrollment({ oid: BV_OID, programKey: 'bala-vihar' }),
      ],
    });
    expect(r.waiver).toEqual({ suggestedAmountOverride: 0 });
  });
});
