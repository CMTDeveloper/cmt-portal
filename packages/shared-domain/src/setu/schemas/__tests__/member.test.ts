import { describe, it, expect } from 'vitest';
import { MemberDocSchema } from '../member';

const base = {
  mid: 'CMT-AB12CD34-02',
  uid: null,
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult' as const,
  gender: 'Female' as const,
  manager: false,
  joinedAt: new Date(),
  email: 'priya@example.com',
  phone: '+14165550199',
  schoolGrade: null,
  birthMonthYear: null,
  volunteeringSkills: [],
  foodAllergies: null,
  emergencyContacts: [
    { relation: 'Spouse', phone: '+14165550111', email: 'spouse@example.com' },
    null,
  ] as [unknown, unknown],
};

describe('MemberDocSchema — multi-contact fields', () => {
  it('defaults altEmails/altPhones to [] when absent (existing docs)', () => {
    const parsed = MemberDocSchema.parse(base);
    expect(parsed.altEmails).toEqual([]);
    expect(parsed.altPhones).toEqual([]);
    expect(parsed.contactsNudgeDismissedAt ?? null).toBeNull();
  });

  it('preserves provided altEmails/altPhones and a dismissed timestamp', () => {
    const parsed = MemberDocSchema.parse({
      ...base,
      altEmails: ['priya.work@example.com'],
      altPhones: ['+14165550200'],
      contactsNudgeDismissedAt: new Date('2026-06-05T00:00:00Z'),
    });
    expect(parsed.altEmails).toEqual(['priya.work@example.com']);
    expect(parsed.altPhones).toEqual(['+14165550200']);
    expect(parsed.contactsNudgeDismissedAt).toBeInstanceOf(Date);
  });
});
