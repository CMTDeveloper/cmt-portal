import { describe, it, expect } from 'vitest';
import {
  NO_ALLERGIES,
  requiredFieldsForType,
  memberFieldComplete,
  whatsMissingForMember,
  isMemberComplete,
  incompleteMembers,
  membersRequiringCompletion,
  type MemberCompletenessInput,
} from '../member-required-fields';

const completeAdult: MemberCompletenessInput = {
  type: 'Adult',
  firstName: 'Asha',
  lastName: 'Rao',
  gender: 'Female',
  foodAllergies: NO_ALLERGIES,
  email: 'asha@example.com',
  phone: '6471234567',
  volunteeringSkills: ['Cooking'],
};

const completeChild: MemberCompletenessInput = {
  type: 'Child',
  firstName: 'Dev',
  lastName: 'Rao',
  gender: 'Male',
  foodAllergies: 'Peanuts',
  schoolGrade: 'Grade 3',
  birthMonthYear: '2017-03',
};

describe('requiredFieldsForType', () => {
  it('adults need contact + skills, not grade/birth', () => {
    const f = requiredFieldsForType('Adult');
    expect(f).toEqual(expect.arrayContaining(['firstName', 'gender', 'foodAllergies', 'email', 'phone', 'volunteeringSkills']));
    expect(f).not.toContain('schoolGrade');
    expect(f).not.toContain('birthMonthYear');
  });
  it('children need grade + birth, not contact/skills', () => {
    const f = requiredFieldsForType('Child');
    expect(f).toEqual(expect.arrayContaining(['firstName', 'gender', 'foodAllergies', 'schoolGrade', 'birthMonthYear']));
    expect(f).not.toContain('email');
    expect(f).not.toContain('phone');
    expect(f).not.toContain('volunteeringSkills');
  });
});

describe('memberFieldComplete — gender', () => {
  it('Male/Female complete; PreferNotToSay and absent are MISSING', () => {
    expect(memberFieldComplete({ ...completeAdult, gender: 'Male' }, 'gender')).toBe(true);
    expect(memberFieldComplete({ ...completeAdult, gender: 'Female' }, 'gender')).toBe(true);
    expect(memberFieldComplete({ ...completeAdult, gender: 'PreferNotToSay' }, 'gender')).toBe(false);
    expect(memberFieldComplete({ ...completeAdult, gender: null }, 'gender')).toBe(false);
  });
});

describe('memberFieldComplete — foodAllergies', () => {
  it('the NO_ALLERGIES sentinel satisfies the requirement; null/empty do not', () => {
    expect(memberFieldComplete({ ...completeAdult, foodAllergies: NO_ALLERGIES }, 'foodAllergies')).toBe(true);
    expect(memberFieldComplete({ ...completeAdult, foodAllergies: 'Dairy' }, 'foodAllergies')).toBe(true);
    expect(memberFieldComplete({ ...completeAdult, foodAllergies: null }, 'foodAllergies')).toBe(false);
    expect(memberFieldComplete({ ...completeAdult, foodAllergies: '  ' }, 'foodAllergies')).toBe(false);
  });
});

describe('memberFieldComplete — volunteeringSkills', () => {
  it('>=1 skill complete; [] and null missing', () => {
    expect(memberFieldComplete({ ...completeAdult, volunteeringSkills: ['X'] }, 'volunteeringSkills')).toBe(true);
    expect(memberFieldComplete({ ...completeAdult, volunteeringSkills: [] }, 'volunteeringSkills')).toBe(false);
    expect(memberFieldComplete({ ...completeAdult, volunteeringSkills: null }, 'volunteeringSkills')).toBe(false);
  });
});

describe('whatsMissingForMember + isMemberComplete', () => {
  it('a complete adult and a complete child are complete', () => {
    expect(whatsMissingForMember(completeAdult)).toEqual([]);
    expect(isMemberComplete(completeAdult)).toBe(true);
    expect(whatsMissingForMember(completeChild)).toEqual([]);
    expect(isMemberComplete(completeChild)).toBe(true);
  });
  it('an adult missing phone + gender reports exactly those', () => {
    const m: MemberCompletenessInput = { ...completeAdult, phone: null, gender: 'PreferNotToSay' };
    expect(whatsMissingForMember(m).sort()).toEqual(['gender', 'phone']);
    expect(isMemberComplete(m)).toBe(false);
  });
  it('a child missing grade reports it; adult-only fields are NOT required for the child', () => {
    const m: MemberCompletenessInput = { ...completeChild, schoolGrade: null, email: null, phone: null };
    expect(whatsMissingForMember(m)).toEqual(['schoolGrade']);
  });
});

describe('incompleteMembers — N=2 family', () => {
  it('returns only the incomplete members with their missing fields', () => {
    const members = [
      { ...completeAdult, mid: 'F-01' },
      { ...completeChild, mid: 'F-02', schoolGrade: null, birthMonthYear: null },
    ];
    const result = incompleteMembers(members);
    expect(result).toEqual([{ mid: 'F-02', missing: expect.arrayContaining(['schoolGrade', 'birthMonthYear']) }]);
  });
  it('an all-complete family yields []', () => {
    expect(
      incompleteMembers([
        { ...completeAdult, mid: 'F-01' },
        { ...completeChild, mid: 'F-02' },
      ]),
    ).toEqual([]);
  });
});

describe('membersRequiringCompletion', () => {
  const manager = { mid: 'F-01', manager: true };
  const child = { mid: 'F-02', manager: false };
  const coManager = { mid: 'F-03', manager: true }; // invited spouse, own login
  const members = [manager, child, coManager];

  it('a plain member is responsible for ONLY their own record', () => {
    expect(membersRequiringCompletion(members, 'F-02', false)).toEqual([child]);
  });

  it('a manager is responsible for own record + non-manager members, NOT co-managers', () => {
    // The original manager must NOT be trapped by an invited co-manager's
    // half-filled record — co-managers self-complete via their own login.
    expect(membersRequiringCompletion(members, 'F-01', true)).toEqual([manager, child]);
  });

  it('a co-manager is responsible for own record + non-managers, not the other manager', () => {
    expect(membersRequiringCompletion(members, 'F-03', true)).toEqual([child, coManager]);
  });

  it('a member with manager undefined/null is treated as a non-manager dependent', () => {
    const legacy = { mid: 'F-04' }; // no manager flag
    expect(membersRequiringCompletion([manager, legacy], 'F-01', true)).toEqual([manager, legacy]);
  });
});
