import { describe, it, expect } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { selectableAdults, teachingAdults } from '../selectable-adults';

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

  it('a retired adult is not offered the class', () => {
    // N=2: the participating adult must survive, or a filter that dropped
    // everyone would pass this just as happily.
    const members = [
      member({ mid: 'f-01' }),
      member({ mid: 'f-02', participation: 'inactive' }),
    ];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01']);
  });

  it('an adult with NO participation field is still offered', () => {
    // Every migrated member doc predates the field; reading absent as retired
    // would make the class un-joinable for the entire existing roster.
    const members = [member({ mid: 'f-01', participation: undefined })];
    expect(mids(selectableAdults(members, new Set()))).toEqual(['f-01']);
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

/**
 * The count behind the "someone in your family is teaching, so they are not
 * listed" line. It exists because §6.6 removes a teaching adult ENTIRELY, and an
 * adult who silently vanishes from their own household's list reads as a data
 * bug - a real family reported exactly that. The screen may say WHY, but must
 * still not say WHO, so this is a count and never a name list.
 */
describe('teachingAdults', () => {
  it('returns the adults the teaching rule removed, and nobody else', () => {
    const members = [
      member({ mid: 'f-01' }),
      member({ mid: 'f-02' }),
      member({ mid: 'f-03', type: 'Child' }),
    ];
    expect(mids(teachingAdults(members, new Set(['f-01'])))).toEqual(['f-01']);
  });

  it('is empty when nobody teaches, so no explanatory row is rendered', () => {
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' })];
    expect(teachingAdults(members, new Set())).toEqual([]);
  });

  it('never returns a CHILD, even one somehow in the teacher set', () => {
    const members = [member({ mid: 'f-01', type: 'Child' })];
    expect(teachingAdults(members, new Set(['f-01']))).toEqual([]);
  });

  it('never returns a pending invitee - they are absent for a different reason', () => {
    // Otherwise the family is told someone is "teaching" when in truth they
    // simply have not accepted their invite yet.
    const members = [member({ mid: 'f-01', inviteStatus: 'pending' } as Partial<MemberDoc> & { mid: string })];
    expect(teachingAdults(members, new Set(['f-01']))).toEqual([]);
  });

  it('PARTITIONS the adults with selectableAdults - disjoint, and together the whole set', () => {
    // The screen renders both lists. If they overlapped, a teaching adult would
    // appear twice (once pickable); if they under-covered, an adult would vanish
    // from their own family's list - the complaint that prompted this change.
    const members = [member({ mid: 'f-01' }), member({ mid: 'f-02' }), member({ mid: 'f-03' })];
    const teaching = new Set(['f-02']);
    const pickable = mids(selectableAdults(members, teaching));
    const shown = mids(teachingAdults(members, teaching));
    expect(pickable.filter((m) => shown.includes(m))).toEqual([]);
    expect([...pickable, ...shown].sort()).toEqual(['f-01', 'f-02', 'f-03']);
  });
});
