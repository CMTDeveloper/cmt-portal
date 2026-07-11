import { describe, it, expect } from 'vitest';
import {
  FamilyEmergencyContactSchema,
  FAMILY_RELATION_OPTIONS,
  FamilyDocSchema,
} from '../family';

describe('FamilyEmergencyContactSchema', () => {
  it('accepts a valid contact', () => {
    const parsed = FamilyEmergencyContactSchema.parse({
      relation: 'Mother',
      phone: '+14165550111',
      email: 'mom@example.com',
    });
    expect(parsed.relation).toBe('Mother');
    expect(parsed.phone).toBe('+14165550111');
    expect(parsed.email).toBe('mom@example.com');
  });

  it('defaults email to empty string when absent', () => {
    const parsed = FamilyEmergencyContactSchema.parse({
      relation: 'Father',
      phone: '+14165550122',
    });
    expect(parsed.email).toBe('');
  });

  it('rejects an empty relation', () => {
    expect(() =>
      FamilyEmergencyContactSchema.parse({ relation: '', phone: '+14165550111' }),
    ).toThrow();
  });

  it('rejects an empty phone', () => {
    expect(() =>
      FamilyEmergencyContactSchema.parse({ relation: 'Mother', phone: '' }),
    ).toThrow();
  });
});

describe('FAMILY_RELATION_OPTIONS', () => {
  it('includes the standard relations', () => {
    expect(FAMILY_RELATION_OPTIONS).toContain('Mother');
    expect(FAMILY_RELATION_OPTIONS).toContain('Father');
    expect(FAMILY_RELATION_OPTIONS).toContain('Other family member');
  });
});

describe('FamilyDocSchema - familyEmergencyContact', () => {
  const base = {
    fid: 'CMT-AB12CD34',
    legacyFid: null,
    name: 'Patel',
    location: 'Brampton' as const,
    createdAt: new Date(),
    managers: ['CMT-AB12CD34-01'],
    searchKeys: ['patel'],
  };

  it('reads absence as no contact (optional)', () => {
    const parsed = FamilyDocSchema.parse(base);
    expect(parsed.familyEmergencyContact ?? null).toBeNull();
  });

  it('reads explicit null as no contact', () => {
    const parsed = FamilyDocSchema.parse({ ...base, familyEmergencyContact: null });
    expect(parsed.familyEmergencyContact).toBeNull();
  });

  it('preserves a stored contact', () => {
    const parsed = FamilyDocSchema.parse({
      ...base,
      familyEmergencyContact: { relation: 'Grandmother', phone: '+14165550199', email: '' },
    });
    expect(parsed.familyEmergencyContact?.relation).toBe('Grandmother');
    expect(parsed.familyEmergencyContact?.phone).toBe('+14165550199');
  });
});
