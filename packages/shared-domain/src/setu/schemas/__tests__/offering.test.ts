import { describe, it, expect } from 'vitest';
import {
  programKeySchema, BALA_VIHAR, OfferingDocSchema, CreateOfferingSchema, paymentSourceOf,
} from '../offering';

describe('programKeySchema', () => {
  it('accepts slugs, rejects junk', () => {
    expect(programKeySchema.safeParse('bala-vihar').success).toBe(true);
    expect(programKeySchema.safeParse('tabla').success).toBe(true);
    expect(programKeySchema.safeParse('Bala Vihar').success).toBe(false);
    expect(programKeySchema.safeParse('').success).toBe(false);
  });
  it('BALA_VIHAR is the seeded key', () => { expect(BALA_VIHAR).toBe('bala-vihar'); });
});

describe('OfferingDoc', () => {
  const base = {
    oid: 'bala-vihar-brampton-2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar',
    location: 'Brampton', termLabel: '2025-26', termType: 'term',
    startDate: new Date('2025-09-01'), endDate: new Date('2026-06-14'),
    pricingTiers: [{ effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year' }],
    enabled: true, createdAt: new Date(), createdBy: 'u', updatedAt: new Date(), updatedBy: 'u',
  };
  it('accepts a full term offering', () => { expect(OfferingDocSchema.safeParse(base).success).toBe(true); });
  it('accepts null location (location-less) and null endDate (rolling)', () => {
    expect(OfferingDocSchema.safeParse({ ...base, location: null, endDate: null, termType: 'rolling' }).success).toBe(true);
  });
  it('accepts empty pricingTiers (free program)', () => {
    expect(OfferingDocSchema.safeParse({ ...base, pricingTiers: [] }).success).toBe(true);
  });
});

describe('CreateOfferingSchema', () => {
  it('requires programKey + termLabel, allows null location & endDate', () => {
    const r = CreateOfferingSchema.safeParse({
      programKey: 'tabla', location: null, termLabel: 'Spring 2026', termType: 'one-time',
      startDate: '2026-04-01T00:00:00.000Z', endDate: '2026-04-01T00:00:00.000Z',
      pricingTiers: [], enabled: true,
    });
    expect(r.success).toBe(true);
  });
});

describe('paymentSourceOf', () => {
  it('defaults to portal', () => { expect(paymentSourceOf({})).toBe('portal'); });
  it('honors legacy', () => { expect(paymentSourceOf({ paymentSource: 'legacy' })).toBe('legacy'); });
  it('honors teacher-managed', () => { expect(paymentSourceOf({ paymentSource: 'teacher-managed' })).toBe('teacher-managed'); });
});
