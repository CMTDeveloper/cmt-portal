import { describe, it, expect } from 'vitest';
import {
  FamilyEmergencyContactSchema,
  FAMILY_RELATION_OPTIONS,
  FamilyDocSchema,
  FamilyAddressSchema,
  isFamilyAddressComplete,
  CANADIAN_PROVINCES,
  CANADIAN_POSTAL_RE,
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

describe('FamilyDocSchema - location (dynamic)', () => {
  it('accepts an admin-added centre not in the default set (location is dynamic)', () => {
    const base = {
      fid: 'CMT-X', legacyFid: null, name: 'Test', location: 'Oakville',
      createdAt: new Date(), managers: ['u1'], searchKeys: [],
    };
    expect(FamilyDocSchema.parse(base).location).toBe('Oakville');
  });
});

describe('CANADIAN_PROVINCES + CANADIAN_POSTAL_RE', () => {
  it('lists Ontario first (code + name)', () => {
    expect(CANADIAN_PROVINCES[0]).toEqual({ code: 'ON', name: 'Ontario' });
    expect(CANADIAN_PROVINCES).toHaveLength(13);
  });

  it('accepts a valid postal code with or without a space', () => {
    expect(CANADIAN_POSTAL_RE.test('L6P 1A2')).toBe(true);
    expect(CANADIAN_POSTAL_RE.test('L6P1A2')).toBe(true);
    expect(CANADIAN_POSTAL_RE.test('l6p1a2')).toBe(true);
  });

  it('rejects an invalid postal code', () => {
    expect(CANADIAN_POSTAL_RE.test('12345')).toBe(false);
    expect(CANADIAN_POSTAL_RE.test('L6P 1A')).toBe(false);
  });
});

describe('FamilyAddressSchema', () => {
  const valid = {
    street: '123 Main St',
    city: 'Brampton',
    province: 'ON',
    postalCode: 'L6P 1A2',
  };

  it('accepts a valid address and defaults unit to empty string', () => {
    const parsed = FamilyAddressSchema.parse(valid);
    expect(parsed.street).toBe('123 Main St');
    expect(parsed.city).toBe('Brampton');
    expect(parsed.province).toBe('ON');
    expect(parsed.postalCode).toBe('L6P 1A2');
    expect(parsed.unit).toBe('');
  });

  it('preserves a provided unit', () => {
    const parsed = FamilyAddressSchema.parse({ ...valid, unit: 'Unit 4' });
    expect(parsed.unit).toBe('Unit 4');
  });

  it('rejects an empty street', () => {
    expect(() => FamilyAddressSchema.parse({ ...valid, street: '' })).toThrow();
  });

  it('rejects an empty city', () => {
    expect(() => FamilyAddressSchema.parse({ ...valid, city: '' })).toThrow();
  });

  it('rejects an empty province', () => {
    expect(() => FamilyAddressSchema.parse({ ...valid, province: '' })).toThrow();
  });

  it('rejects a bad postal code', () => {
    expect(() => FamilyAddressSchema.parse({ ...valid, postalCode: '12345' })).toThrow();
  });
});

describe('isFamilyAddressComplete', () => {
  const complete = {
    street: '123 Main St',
    unit: '',
    city: 'Brampton',
    province: 'ON',
    postalCode: 'L6P 1A2',
  };

  it('is true when all required parts are present', () => {
    expect(isFamilyAddressComplete({ familyAddress: complete })).toBe(true);
  });

  it('is false when the address is null', () => {
    expect(isFamilyAddressComplete({ familyAddress: null })).toBe(false);
  });

  it('is false when the address is absent', () => {
    expect(isFamilyAddressComplete({})).toBe(false);
  });

  it('is false when a required part is missing', () => {
    expect(isFamilyAddressComplete({ familyAddress: { ...complete, city: '' } })).toBe(false);
    expect(isFamilyAddressComplete({ familyAddress: { ...complete, postalCode: '' } })).toBe(false);
  });
});

describe('FamilyDocSchema - familyAddress', () => {
  const base = {
    fid: 'CMT-AB12CD34',
    legacyFid: null,
    name: 'Patel',
    location: 'Brampton' as const,
    createdAt: new Date(),
    managers: ['CMT-AB12CD34-01'],
    searchKeys: ['patel'],
  };

  it('reads absence as no address (optional)', () => {
    const parsed = FamilyDocSchema.parse(base);
    expect(parsed.familyAddress ?? null).toBeNull();
  });

  it('reads explicit null as no address', () => {
    const parsed = FamilyDocSchema.parse({ ...base, familyAddress: null });
    expect(parsed.familyAddress).toBeNull();
  });

  it('preserves a stored address', () => {
    const parsed = FamilyDocSchema.parse({
      ...base,
      familyAddress: {
        street: '123 Main St',
        unit: 'Unit 4',
        city: 'Brampton',
        province: 'ON',
        postalCode: 'L6P 1A2',
      },
    });
    expect(parsed.familyAddress?.street).toBe('123 Main St');
    expect(parsed.familyAddress?.province).toBe('ON');
  });
});
