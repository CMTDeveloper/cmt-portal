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
