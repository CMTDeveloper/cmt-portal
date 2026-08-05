import { describe, it, expect } from 'vitest';
import {
  NO_ALLERGIES,
  requiredFieldsForType,
  memberFieldComplete,
  whatsMissingForMember,
  isMemberComplete,
  incompleteMembers,
  membersRequiringCompletion,
  recordedAllergy,
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

  it('EXCLUDES a pending-invite member — nobody must complete their profile until they accept', () => {
    // A co-manager invited but not yet accepted (inviteStatus:'pending', no
    // session) must never block the original manager's gate, even though it is
    // a non-manager-... wait it is manager:true; belt-and-braces on inviteStatus.
    const pending = { mid: 'F-05', manager: true, inviteStatus: 'pending' as const };
    const pendingDependent = { mid: 'F-06', manager: false, inviteStatus: 'pending' as const };
    const all = [manager, child, pending, pendingDependent];
    // Manager scope: own + non-manager dependents, but NEITHER pending row.
    expect(membersRequiringCompletion(all, 'F-01', true)).toEqual([manager, child]);
  });

  // ── Inactive members do not block ─────────────────────────────────────────
  //
  // 🔴 Reported from production 2026-08-02. A father: *"Son Archish has already
  // finished BV, system is forcing me to pick a grade for him. Similarly it is
  // forcing pick details for spouse, she has other commitments... for Archish I
  // need an option, I am blocked."*
  //
  // Both of his people are legitimately here - the son has history worth keeping
  // and the spouse is on the family - they just are not participating. Before
  // this the only two ways out were to invent a school grade or to delete the
  // person, and deleting loses the history.
  describe('inactive members', () => {
    it('does NOT block on a member who no longer participates', () => {
      const graduatedSon = { mid: 'F-07', manager: false, participation: 'inactive' as const };
      const absentSpouse = { mid: 'F-08', manager: false, participation: 'inactive' as const };
      const all = [manager, child, graduatedSon, absentSpouse];
      expect(membersRequiringCompletion(all, 'F-01', true)).toEqual([manager, child]);
    });

    it('still blocks on an ACTIVE member - N=2, so "inactive" is not read as "all of them"', () => {
      // One inactive sibling must not excuse the other. The single-inactive
      // fixture would pass even if the filter dropped every dependent.
      const inactiveSibling = { mid: 'F-07', manager: false, participation: 'inactive' as const };
      const activeSibling = { mid: 'F-09', manager: false, participation: 'active' as const };
      const all = [manager, inactiveSibling, activeSibling];
      expect(membersRequiringCompletion(all, 'F-01', true)).toEqual([manager, activeSibling]);
    });

    it('treats an ABSENT participation field as active - every migrated doc predates it', () => {
      // 2033 production member docs have no `participation`. If absent read as
      // inactive, the gate would silently stop asking anyone for anything.
      const legacyDoc = { mid: 'F-10', manager: false };
      expect(membersRequiringCompletion([manager, legacyDoc], 'F-01', true)).toEqual([
        manager,
        legacyDoc,
      ]);
    });

    it('excuses an inactive member from a PLAIN member scope too, not just a manager scope', () => {
      // Otherwise a non-manager who was deactivated is trapped on
      // /complete-profile by their own record, with no way to edit anyone.
      const self = { mid: 'F-11', manager: false, participation: 'inactive' as const };
      expect(membersRequiringCompletion([manager, self], 'F-11', false)).toEqual([]);
    });
  });

  describe('recordedAllergy', () => {
    // The reader half of NO_ALLERGIES. The "No known allergies" affordance
    // WRITES the literal 'None' so a family can satisfy the required
    // foodAllergies field without inventing an allergy - but for two months
    // every reader treated "non-empty string" as "has an allergy". In
    // production on 2026-08-05 that was 104 members reading as a SEVERE
    // allergy against ONE real one ("nuts, pollen"), on the teacher attendance
    // marker, the class list, both student profiles and the staff family page.
    // The harm is not the badge, it is that 104 false markers teach staff to
    // ignore the one that matters.

    it('returns null for the sentinel the "No known allergies" box writes', () => {
      expect(recordedAllergy(NO_ALLERGIES)).toBeNull();
    });

    it('returns the text for a real allergy', () => {
      expect(recordedAllergy('nuts, pollen')).toBe('nuts, pollen');
    });

    it('returns null for absent, empty and whitespace-only values', () => {
      expect(recordedAllergy(null)).toBeNull();
      expect(recordedAllergy(undefined)).toBeNull();
      expect(recordedAllergy('')).toBeNull();
      expect(recordedAllergy('   ')).toBeNull();
    });

    it('matches the sentinel regardless of case or surrounding space', () => {
      // The same string arrives typed by hand into the free-text box, not only
      // from the checkbox.
      for (const v of ['none', 'NONE', '  None  ', 'N/A', 'nil', 'no known allergies']) {
        expect(recordedAllergy(v), v).toBeNull();
      }
    });

    it('NEVER matches on a substring - "no nuts" is a real allergy', () => {
      // The whole reason this compares whole strings: an allergy phrased as a
      // negative ("no nuts", "none except dairy") is still an allergy, and
      // silencing it is the one failure mode worse than the noise we are
      // fixing. Fail toward showing the warning.
      expect(recordedAllergy('no nuts')).toBe('no nuts');
      expect(recordedAllergy('none except dairy')).toBe('none except dairy');
      expect(recordedAllergy('No dairy or eggs')).toBe('No dairy or eggs');
    });

    it('trims the text it returns, so a padded value cannot render as blank', () => {
      expect(recordedAllergy('  peanuts  ')).toBe('peanuts');
    });
  });
});
