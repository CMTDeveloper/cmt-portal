import { describe, it, expect } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { memberToDisplay } from '../member-display';

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
