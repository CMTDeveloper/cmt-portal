import { describe, it, expect } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { selectableAdults } from '../selectable-adults';

/**
 * One test per row of the spec's scenario matrix (2.3), plus the two exclusions.
 *
 * The matrix's own point is that rows 3, 4 and 7 all resolve through ONE
 * mechanism - an empty selectable set - rather than a literal "if both parents
 * are teachers" check, which would have handled row 3 and quietly missed 4 and 7.
 * So each of those rows is asserted separately even though they share a cause.
 */

function member(over: Partial<MemberDoc> & { mid: string }): MemberDoc {
  return {
    uid: null,
    firstName: 'A',
    lastName: 'Parent',
    type: 'Adult',
    gender: 'PreferNotToSay',
    manager: false,
    joinedAt: new Date(),
    email: null,
    phone: null,
    schoolGrade: null,
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: null,
    emergencyContacts: [null, null],
    ...over,
  } as MemberDoc;
}

const mids = (ms: MemberDoc[]) => ms.map((m) => m.mid);

describe('selectableAdults - the scenario matrix', () => {
  it('row 1: two non-teaching adults are both selectable', () => {
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' })];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01', 'f-02']);
  });

  it('row 2: one parent teaches - only the non-teacher is offered', () => {
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' })];
    expect(mids(selectableAdults(members, new Set(['f-01'])))).toEqual(['f-02']);
  });

  it('row 3: both parents teach - the selectable set is EMPTY', () => {
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' })];
    expect(selectableAdults(members, new Set(['f-01', 'f-02']))).toEqual([]);
  });

  it('row 4: a single parent who teaches - EMPTY', () => {
    const members = [member({ mid: 'f-01' })];
    expect(selectableAdults(members, new Set(['f-01']))).toEqual([]);
  });

  it('row 5: a single non-teaching parent - EXACTLY one, so the UI can preselect', () => {
    // The plan calls this out specifically: v1 had no test for row 5 despite the
    // spec asking for one per row. It is also the row the "preselect when there
    // is exactly one" UI behaviour depends on.
    const members = [member({ mid: 'f-01' })];
    const result = selectableAdults(members, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]!.mid).toBe('f-01');
  });

  it('row 6: adults with no BV children are still selectable here', () => {
    // This function does not know about Bala Vihar. Row 6 is decided by the
    // GATE (no BV enrollment), not by the selectable set - a family with no
    // children may still enroll voluntarily and pays the configured amount.
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' })];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01', 'f-02']);
  });

  it('row 7: adults-only household where both teach - EMPTY', () => {
    // Row 7 fails the gate twice over; this is the selectable-set half. The
    // other half (no BV enrollment) belongs to needsAdultClassSelection and is
    // asserted there, independently, per spec 2.3.
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' })];
    expect(selectableAdults(members, new Set(['f-01', 'f-02']))).toEqual([]);
  });
});

describe('selectableAdults - exclusions', () => {
  it('never offers a CHILD', () => {
    const members = [
      member({ mid: 'f-01' }),
      member({ mid: 'f-03', type: 'Child', schoolGrade: '4' }),
    ];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01']);
  });

  it('never offers a PENDING invitee', () => {
    // A pending co-manager has not accepted yet - they are a placeholder record,
    // not someone who can be committed to attending a class.
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02', inviteStatus: 'pending' })];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01']);
  });

  it('DOES offer a member whose inviteStatus is absent or null (an ordinary adult)', () => {
    const members = [
      member({ mid: 'f-01' }),
      member({ mid: 'f-02', inviteStatus: null }),
    ];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01', 'f-02']);
  });

  it('is pure - it does not mutate or reorder the input', () => {
    const members = [member({ mid: 'f-02' }), member({ mid: 'f-01' })];
    const snapshot = mids(members);
    const result = selectableAdults(members, new Set());
    expect(mids(members)).toEqual(snapshot);          // input untouched
    expect(mids(result)).toEqual(['f-02', 'f-01']);   // stored order preserved
  });

  it('handles an empty family without throwing', () => {
    expect(selectableAdults([], new Set())).toEqual([]);
  });
});
