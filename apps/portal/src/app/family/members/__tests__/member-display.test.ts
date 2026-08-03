import { describe, it, expect } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { memberToDisplay, memberStatusChip, type DisplayMember } from '../member-display';

function makeMember(overrides: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'CMT-FAM1-02',
    uid: null,
    firstName: 'Asha',
    lastName: 'Patel',
    type: 'Adult',
    gender: 'Female',
    manager: false,
    joinedAt: new Date('2024-09-01T00:00:00Z'),
    email: 'asha@example.com',
    phone: '+14165550000',
    altEmails: [],
    altPhones: [],
    schoolGrade: null,
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: null,
    emergencyContacts: [{ relation: 'NOK', phone: '0000000', email: 'n@k.com' }, null],
    ...overrides,
  };
}

describe('memberToDisplay — Make-manager eligibility (issue #12 follow-up)', () => {
  it('marks an Adult as isAdult (eligible for the Make-manager button)', () => {
    expect(memberToDisplay(makeMember({ type: 'Adult' }), null).isAdult).toBe(true);
  });

  it('marks a Child as NOT isAdult (Make-manager must never show for children)', () => {
    const d = memberToDisplay(makeMember({ type: 'Child', schoolGrade: 'Grade 5' }), null);
    expect(d.isAdult).toBe(false);
    expect(d.type).toBe('Child · Grade 5');
  });

  it('still reflects the manager flag independently of isAdult', () => {
    expect(memberToDisplay(makeMember({ type: 'Adult', manager: true }), null).isManager).toBe(true);
    expect(memberToDisplay(makeMember({ type: 'Adult', manager: false }), null).isManager).toBe(false);
  });
});

describe('memberToDisplay — missingCount (Slice 1 Part D)', () => {
  it('is 0 for a fully-complete adult', () => {
    const m = makeMember({ type: 'Adult', foodAllergies: 'None', volunteeringSkills: ['Cooking'] });
    expect(memberToDisplay(m, 'FAM1-01').missingCount).toBe(0);
  });

  it('is 0 for a fully-complete child', () => {
    const m = makeMember({ type: 'Child', foodAllergies: 'None', schoolGrade: 'Grade 3', birthMonthYear: '2017-05' });
    expect(memberToDisplay(m, 'FAM1-01').missingCount).toBe(0);
  });

  it('counts a child missing schoolGrade + birthMonthYear as 2', () => {
    const m = makeMember({ type: 'Child', foodAllergies: 'None', schoolGrade: null, birthMonthYear: null });
    expect(memberToDisplay(m, 'FAM1-01').missingCount).toBe(2);
  });
});

describe('memberToDisplay — pending invite (Feature B)', () => {
  it('flags a pending-invite member and shows an "Invite pending" tag', () => {
    // An invited co-manager, created at invite-send but not yet accepted.
    const m = makeMember({ manager: true, inviteStatus: 'pending', uid: null });
    const d = memberToDisplay(m, null);
    expect(d.invitePending).toBe(true);
    expect(d.tag).toBe('Invite pending');
  });

  it('never shows a missing-field count for a pending member (they complete their own profile after accepting)', () => {
    // Missing gender/skills would normally count > 0; pending suppresses it.
    const m = makeMember({ manager: true, inviteStatus: 'pending', gender: 'PreferNotToSay', volunteeringSkills: [], foodAllergies: null });
    expect(memberToDisplay(m, null).missingCount).toBe(0);
  });

  it('a normal (accepted) member is not flagged pending', () => {
    expect(memberToDisplay(makeMember({ manager: true }), null).invitePending).toBe(false);
    expect(memberToDisplay(makeMember({ manager: true }), null).tag).toBe('Manager');
  });
});

describe('memberToDisplay — retired members (production reports 2026-08-02)', () => {
  // Vaibhav: "option for family to disable member who are no longer active, Not
  // to delete as we loose history." So they must stay LISTED - and must be
  // unmistakably marked, or the family sees a normal member and wonders why
  // nothing asks about them any more.
  it('flags a member the family has retired', () => {
    const d = memberToDisplay(makeMember({ participation: 'inactive' } as Partial<MemberDoc>), null);
    expect(d.inactive).toBe(true);
  });

  it('treats an ABSENT participation as active — every migrated doc predates the field', () => {
    // The one that matters at scale: 2033 production member docs have no
    // `participation`. Read as "not active" they would ALL render as retired.
    expect(memberToDisplay(makeMember(), null).inactive).toBe(false);
    expect(memberToDisplay(makeMember({ participation: 'active' } as Partial<MemberDoc>), null).inactive).toBe(false);
  });

  it('stops counting missing fields for a retired member', () => {
    // We no longer ask for their details, so "3 fields to complete" would be a
    // demand the portal has just finished promising it would not make.
    const d = memberToDisplay(
      makeMember({ type: 'Child', schoolGrade: null, birthMonthYear: null, participation: 'inactive' } as Partial<MemberDoc>),
      null,
    );
    expect(d.missingCount).toBe(0);
    // …and the same member, still participating, IS counted.
    const active = memberToDisplay(
      makeMember({ type: 'Child', schoolGrade: null, birthMonthYear: null }),
      null,
    );
    expect(active.missingCount).toBeGreaterThan(0);
  });
});

describe('memberStatusChip — one decision for BOTH layout trees', () => {
  // The phone and desktop trees both render, always, and each used to carry its
  // own copy of this ternary. A state added to one and missed in the other is
  // invisible in review and invisible in tests. Asserting the shared descriptor
  // is what makes "it shows on the phone too" true by construction.
  const chip = (over: Partial<DisplayMember>) =>
    memberStatusChip({
      mid: 'CMT-FAM1-02', name: 'Asha', type: 'Adult', tag: null, isManager: false,
      isAdult: true, warn: null, email: null, phone: null, role: null, isCurrent: false,
      nameMissing: false, missingCount: 0, invitePending: false, inactive: false,
      ...over,
    });

  it('names a retired member in both the short and the long form', () => {
    const c = chip({ inactive: true });
    expect(c.label).toMatch(/No longer participating/i);
    expect(c.labelLong).toMatch(/No longer participating/i);
    expect(c.href).toBeNull(); // nothing to go and complete
  });

  it('lets nothing speak over "retired" — not a pending invite, not missing fields', () => {
    // A retired member has no fields to chase and no invite to await. The portal
    // has just told the family it will stop asking; a "2 fields to complete"
    // chip would be that same demand wearing a different hat.
    expect(chip({ inactive: true, missingCount: 2 }).label).toMatch(/No longer participating/i);
    expect(chip({ inactive: true, invitePending: true }).label).toMatch(/No longer participating/i);
  });

  it('is unchanged for everyone else', () => {
    expect(chip({ invitePending: true }).label).toBe('Invite pending');
    expect(chip({ missingCount: 3 }).label).toBe('Complete info (3)');
    expect(chip({ missingCount: 3 }).href).toBe('/family/members/CMT-FAM1-02/edit');
    expect(chip({}).label).toBe('✓ Complete');
  });
});
