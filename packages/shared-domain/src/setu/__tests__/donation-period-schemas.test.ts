import { describe, it, expect } from 'vitest';
import {
  CreateOfferingSchema,
  UpdateOfferingSchema,
  OfferingDocSchema,
  resolveSuggestedAmount,
  paymentSourceOf,
  type PricingTier,
} from '../schemas/offering';

const FUTURE_START = '2027-09-01T04:00:00.000Z';
const FUTURE_END = '2028-06-30T04:59:59.000Z';

const TIERS = [
  { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' },
  { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'Joined winter' },
  { effectiveFrom: '2028-02-01', amountCAD: 200, label: 'Joined spring' },
];

const validCreate = {
  programKey: 'bala-vihar',
  location: 'Brampton' as const,
  termLabel: '2027-28',
  termType: 'term' as const,
  startDate: FUTURE_START,
  endDate: FUTURE_END,
  pricingTiers: TIERS,
  enabled: true,
};

// ── CreateOfferingSchema ───────────────────────────────────────────────────────

describe('CreateOfferingSchema', () => {
  it('accepts a valid create payload', () => {
    expect(CreateOfferingSchema.safeParse(validCreate).success).toBe(true);
  });

  it('accepts all valid locations', () => {
    for (const location of ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const) {
      expect(CreateOfferingSchema.safeParse({ ...validCreate, location }).success).toBe(true);
    }
  });

  it('accepts null location (location-less program)', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, location: null }).success).toBe(true);
  });

  it('rejects unknown location string', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, location: 'Toronto' }).success).toBe(false);
  });

  it('accepts any valid programKey slug (dynamic)', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, programKey: 'tabla' }).success).toBe(true);
  });

  it('rejects a programKey with uppercase or spaces', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, programKey: 'Bala Vihar' }).success).toBe(false);
  });

  it('accepts empty pricingTiers (free program)', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, pricingTiers: [] }).success).toBe(true);
  });

  it('rejects a tier with amount 0', () => {
    expect(
      CreateOfferingSchema.safeParse({
        ...validCreate,
        pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 0, label: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a tier with a bad date format', () => {
    expect(
      CreateOfferingSchema.safeParse({
        ...validCreate,
        pricingTiers: [{ effectiveFrom: 'Sept 1', amountCAD: 500, label: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects non-ascending tier dates', () => {
    expect(
      CreateOfferingSchema.safeParse({
        ...validCreate,
        pricingTiers: [
          { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'b' },
          { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'a' },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts endDate equal to startDate (rolling/one-time offerings)', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, endDate: FUTURE_START }).success).toBe(true);
  });

  it('rejects endDate before startDate', () => {
    expect(
      CreateOfferingSchema.safeParse({ ...validCreate, startDate: FUTURE_END, endDate: FUTURE_START }).success,
    ).toBe(false);
  });

  it('accepts null endDate (rolling offering)', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, endDate: null, termType: 'rolling' }).success).toBe(true);
  });

  it('rejects missing termLabel', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { termLabel, ...rest } = validCreate;
    expect(CreateOfferingSchema.safeParse(rest).success).toBe(false);
  });

  it('defaults enabled to true when omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enabled, ...rest } = validCreate;
    const result = CreateOfferingSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(true);
  });

  it('defaults paymentSource to portal when omitted', () => {
    const result = CreateOfferingSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paymentSource).toBe('portal');
  });

  it('accepts external payment sources', () => {
    const legacy = CreateOfferingSchema.safeParse({ ...validCreate, paymentSource: 'legacy' });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.paymentSource).toBe('legacy');

    const teacherManaged = CreateOfferingSchema.safeParse({ ...validCreate, paymentSource: 'teacher-managed' });
    expect(teacherManaged.success).toBe(true);
    if (teacherManaged.success) expect(teacherManaged.data.paymentSource).toBe('teacher-managed');
  });

  it('rejects an unknown paymentSource', () => {
    expect(CreateOfferingSchema.safeParse({ ...validCreate, paymentSource: 'cash' }).success).toBe(false);
  });
});

describe('paymentSourceOf', () => {
  it('defaults to portal when unset (back-compat)', () => {
    expect(paymentSourceOf({})).toBe('portal');
  });
  it('returns the explicit source', () => {
    expect(paymentSourceOf({ paymentSource: 'legacy' })).toBe('legacy');
    expect(paymentSourceOf({ paymentSource: 'portal' })).toBe('portal');
    expect(paymentSourceOf({ paymentSource: 'teacher-managed' })).toBe('teacher-managed');
  });
});

// ── UpdateOfferingSchema ───────────────────────────────────────────────────────

describe('UpdateOfferingSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(UpdateOfferingSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial update with only pricingTiers', () => {
    expect(UpdateOfferingSchema.safeParse({ pricingTiers: TIERS }).success).toBe(true);
  });

  it('accepts a partial update with only enabled toggle', () => {
    expect(UpdateOfferingSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('rejects when both dates provided and endDate < startDate', () => {
    expect(
      UpdateOfferingSchema.safeParse({ startDate: FUTURE_END, endDate: FUTURE_START }).success,
    ).toBe(false);
  });

  it('accepts endDate equal to startDate (one-time offering, mirrors Create)', () => {
    expect(
      UpdateOfferingSchema.safeParse({ startDate: FUTURE_START, endDate: FUTURE_START }).success,
    ).toBe(true);
  });

  it('accepts null endDate alongside a startDate (rolling offering)', () => {
    expect(
      UpdateOfferingSchema.safeParse({ startDate: FUTURE_START, endDate: null }).success,
    ).toBe(true);
  });

  it('accepts empty pricingTiers (free program)', () => {
    expect(UpdateOfferingSchema.safeParse({ pricingTiers: [] }).success).toBe(true);
  });

  it('rejects non-ascending pricingTiers', () => {
    expect(
      UpdateOfferingSchema.safeParse({
        pricingTiers: [
          { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'b' },
          { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'a' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects empty termLabel string', () => {
    expect(UpdateOfferingSchema.safeParse({ termLabel: '' }).success).toBe(false);
  });
});

// ── OfferingDocSchema ──────────────────────────────────────────────────────────

describe('OfferingDocSchema', () => {
  const validDoc = {
    oid: 'bala-vihar-brampton-2027-28',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton' as const,
    termLabel: '2027-28',
    termType: 'term' as const,
    startDate: new Date(FUTURE_START),
    endDate: new Date(FUTURE_END),
    pricingTiers: TIERS,
    enabled: true,
    createdAt: new Date(),
    createdBy: 'uid-admin',
    updatedAt: new Date(),
    updatedBy: 'uid-admin',
  };

  it('accepts a valid offering doc', () => {
    expect(OfferingDocSchema.safeParse(validDoc).success).toBe(true);
  });

  it('accepts a doc with optional amountTiers present', () => {
    expect(OfferingDocSchema.safeParse({ ...validDoc, amountTiers: [500, 750] }).success).toBe(true);
  });

  it('accepts null location (location-less)', () => {
    expect(OfferingDocSchema.safeParse({ ...validDoc, location: null }).success).toBe(true);
  });

  it('accepts null endDate (rolling)', () => {
    expect(OfferingDocSchema.safeParse({ ...validDoc, endDate: null, termType: 'rolling' }).success).toBe(true);
  });

  it('accepts empty pricingTiers (free program)', () => {
    expect(OfferingDocSchema.safeParse({ ...validDoc, pricingTiers: [] }).success).toBe(true);
  });

  it('rejects missing oid', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { oid, ...rest } = validDoc;
    expect(OfferingDocSchema.safeParse(rest).success).toBe(false);
  });
});

// ── resolveSuggestedAmount ─────────────────────────────────────────────────────

describe('resolveSuggestedAmount', () => {
  const offering = { pricingTiers: TIERS as PricingTier[] };

  it('uses the first (full-year) tier before any window opens', () => {
    // 2027-08-01 (Toronto) — before the Sept tier
    expect(resolveSuggestedAmount(offering, new Date('2027-08-01T17:00:00Z'))).toBe(500);
  });

  it('uses the full-year tier in September', () => {
    expect(resolveSuggestedAmount(offering, new Date('2027-10-15T17:00:00Z'))).toBe(500);
  });

  it('uses the winter tier from December', () => {
    expect(resolveSuggestedAmount(offering, new Date('2027-12-15T17:00:00Z'))).toBe(300);
  });

  it('uses the spring tier from February', () => {
    expect(resolveSuggestedAmount(offering, new Date('2028-03-10T17:00:00Z'))).toBe(200);
  });

  it('applies a tier exactly on its effectiveFrom date', () => {
    expect(resolveSuggestedAmount(offering, new Date('2027-12-01T17:00:00Z'))).toBe(300);
  });

  it('handles a single-tier schedule', () => {
    expect(
      resolveSuggestedAmount({ pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 450, label: 'flat' }] }, new Date('2028-01-01T17:00:00Z')),
    ).toBe(450);
  });

  it('returns 0 for an empty pricingTiers (free program)', () => {
    expect(resolveSuggestedAmount({ pricingTiers: [] }, new Date('2027-09-01T17:00:00Z'))).toBe(0);
  });
});
