import { describe, it, expect } from 'vitest';
import { FamilyDocSchema } from '../schemas/family';
import { MemberDocSchema } from '../schemas/member';
import { ContactKeyDocSchema, normalizeContactForKey } from '../schemas/contact-key';

// ── FamilyDoc ─────────────────────────────────────────────────────────────────

describe('FamilyDocSchema', () => {
  const validFamily = {
    fid: 'FAM001ABCD12',
    legacyFid: null,
    name: 'Patel',
    location: 'Brampton' as const,
    createdAt: new Date(),
    managers: ['FAM001ABCD12-01'],
    searchKeys: ['patel', 'FAM001ABCD12'],
  };

  it('accepts a valid family doc', () => {
    expect(FamilyDocSchema.safeParse(validFamily).success).toBe(true);
  });

  it('accepts all valid locations', () => {
    for (const location of ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const) {
      expect(FamilyDocSchema.safeParse({ ...validFamily, location }).success).toBe(true);
    }
  });

  it('rejects unknown location', () => {
    expect(FamilyDocSchema.safeParse({ ...validFamily, location: 'Toronto' }).success).toBe(false);
  });

  it('accepts null legacyFid', () => {
    expect(FamilyDocSchema.safeParse({ ...validFamily, legacyFid: null }).success).toBe(true);
  });

  it('accepts string legacyFid', () => {
    expect(FamilyDocSchema.safeParse({ ...validFamily, legacyFid: '4421' }).success).toBe(true);
  });

  it('rejects missing name', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name, ...rest } = validFamily;
    expect(FamilyDocSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty managers array (must have at least one)', () => {
    expect(FamilyDocSchema.safeParse({ ...validFamily, managers: [] }).success).toBe(false);
  });
});

// ── MemberDoc ─────────────────────────────────────────────────────────────────

describe('MemberDocSchema', () => {
  const validAdult = {
    mid: 'FAM001-01',
    uid: null,
    firstName: 'Raj',
    lastName: 'Patel',
    type: 'Adult' as const,
    gender: 'Male' as const,
    manager: true,
    joinedAt: new Date(),
    email: 'raj@example.com',
    phone: '+14165550100',
    schoolGrade: null,
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: null,
    emergencyContacts: [
      { relation: 'Spouse', phone: '+14165550101', email: 'priya@example.com' },
      null,
    ],
  };

  const validChild = {
    mid: 'FAM001-02',
    uid: null,
    firstName: 'Diya',
    lastName: 'Patel',
    type: 'Child' as const,
    gender: 'Female' as const,
    manager: false,
    joinedAt: new Date(),
    email: null,
    phone: null,
    schoolGrade: 'Grade 5',
    birthMonthYear: 'Mar 2017',
    volunteeringSkills: [],
    foodAllergies: 'Peanuts',
    emergencyContacts: [
      { relation: 'Father', phone: '+14165550100', email: 'raj@example.com' },
      null,
    ],
  };

  it('accepts a valid adult member', () => {
    expect(MemberDocSchema.safeParse(validAdult).success).toBe(true);
  });

  it('accepts a valid child member', () => {
    expect(MemberDocSchema.safeParse(validChild).success).toBe(true);
  });

  it('accepts all gender values', () => {
    for (const gender of ['Male', 'Female', 'PreferNotToSay'] as const) {
      expect(MemberDocSchema.safeParse({ ...validAdult, gender }).success).toBe(true);
    }
  });

  it('rejects unknown gender', () => {
    expect(MemberDocSchema.safeParse({ ...validAdult, gender: 'Other' }).success).toBe(false);
  });

  it('accepts both Adult and Child types', () => {
    expect(MemberDocSchema.safeParse({ ...validAdult, type: 'Adult' }).success).toBe(true);
    expect(MemberDocSchema.safeParse({ ...validChild, type: 'Child' }).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(MemberDocSchema.safeParse({ ...validAdult, type: 'Teen' }).success).toBe(false);
  });

  it('accepts two emergency contacts', () => {
    const twoContacts = {
      ...validAdult,
      emergencyContacts: [
        { relation: 'Spouse', phone: '+14165550101', email: 'priya@example.com' },
        { relation: 'Sibling', phone: '+14165550102', email: 'bro@example.com' },
      ],
    };
    expect(MemberDocSchema.safeParse(twoContacts).success).toBe(true);
  });

  it('rejects missing firstName', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { firstName, ...rest } = validAdult;
    expect(MemberDocSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts null uid (pre-sign-in)', () => {
    expect(MemberDocSchema.safeParse({ ...validAdult, uid: null }).success).toBe(true);
  });

  it('accepts string uid (post-sign-in)', () => {
    expect(MemberDocSchema.safeParse({ ...validAdult, uid: 'firebase-uid-abc' }).success).toBe(true);
  });
});

// ── ContactKeyDoc ─────────────────────────────────────────────────────────────

describe('ContactKeyDocSchema', () => {
  const validContactKey = {
    contactKey: 'a'.repeat(64),
    type: 'email' as const,
    fid: 'FAM001ABCD12',
    mid: 'FAM001ABCD12-01',
  };

  it('accepts a valid email contact key', () => {
    expect(ContactKeyDocSchema.safeParse(validContactKey).success).toBe(true);
  });

  it('accepts a valid phone contact key', () => {
    expect(ContactKeyDocSchema.safeParse({ ...validContactKey, type: 'phone' }).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(ContactKeyDocSchema.safeParse({ ...validContactKey, type: 'sms' }).success).toBe(false);
  });

  it('rejects missing fid', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fid, ...rest } = validContactKey;
    expect(ContactKeyDocSchema.safeParse(rest).success).toBe(false);
  });
});

// ── normalizeContactForKey ────────────────────────────────────────────────────

describe('normalizeContactForKey', () => {
  it('email: lowercases and trims', () => {
    expect(normalizeContactForKey('email', 'Foo@Bar.com')).toBe('foo@bar.com');
    expect(normalizeContactForKey('email', '  raj@example.com  ')).toBe('raj@example.com');
  });

  it('email: already lowercase is unchanged', () => {
    expect(normalizeContactForKey('email', 'foo@bar.com')).toBe('foo@bar.com');
  });

  it('phone: strips non-digits and normalizes to +1XXXXXXXXXX', () => {
    expect(normalizeContactForKey('phone', '(416) 555-2204')).toBe('+14165552204');
  });

  it('phone: 10-digit and +1-prefixed 11-digit normalize identically', () => {
    expect(normalizeContactForKey('phone', '4165552204')).toBe('+14165552204');
    expect(normalizeContactForKey('phone', '+14165552204')).toBe('+14165552204');
  });

  it('phone: 11-digit with leading 1 strips the 1', () => {
    expect(normalizeContactForKey('phone', '14165552204')).toBe('+14165552204');
  });
});
