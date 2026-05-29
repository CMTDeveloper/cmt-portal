import { describe, it, expect } from 'vitest';
import {
  CreateDonationPeriodSchema,
  UpdateDonationPeriodSchema,
  DonationPeriodDocSchema,
  resolveSuggestedAmount,
  paymentSourceOf,
  type PricingTier,
} from '../schemas/donation-period';

const FUTURE_START = '2027-09-01T04:00:00.000Z';
const FUTURE_END = '2028-06-30T04:59:59.000Z';

const TIERS = [
  { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'Full year' },
  { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'Joined winter' },
  { effectiveFrom: '2028-02-01', amountCAD: 200, label: 'Joined spring' },
];

const validCreate = {
  programKey: 'bala-vihar' as const,
  location: 'Brampton' as const,
  periodLabel: '2027-28',
  startDate: FUTURE_START,
  endDate: FUTURE_END,
  pricingTiers: TIERS,
  enabled: true,
};

// ── CreateDonationPeriodSchema ─────────────────────────────────────────────────

describe('CreateDonationPeriodSchema', () => {
  it('accepts a valid create payload', () => {
    expect(CreateDonationPeriodSchema.safeParse(validCreate).success).toBe(true);
  });

  it('accepts all valid locations', () => {
    for (const location of ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const) {
      expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, location }).success).toBe(true);
    }
  });

  it('rejects unknown location', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, location: 'Toronto' }).success).toBe(false);
  });

  it('rejects unknown programKey', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, programKey: 'yoga' }).success).toBe(false);
  });

  it('rejects empty pricingTiers array', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, pricingTiers: [] }).success).toBe(false);
  });

  it('rejects a tier with amount 0', () => {
    expect(
      CreateDonationPeriodSchema.safeParse({
        ...validCreate,
        pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 0, label: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a tier with a bad date format', () => {
    expect(
      CreateDonationPeriodSchema.safeParse({
        ...validCreate,
        pricingTiers: [{ effectiveFrom: 'Sept 1', amountCAD: 500, label: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects non-ascending tier dates', () => {
    expect(
      CreateDonationPeriodSchema.safeParse({
        ...validCreate,
        pricingTiers: [
          { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'b' },
          { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'a' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects endDate equal to startDate', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, endDate: FUTURE_START }).success).toBe(false);
  });

  it('rejects endDate before startDate', () => {
    expect(
      CreateDonationPeriodSchema.safeParse({ ...validCreate, startDate: FUTURE_END, endDate: FUTURE_START }).success,
    ).toBe(false);
  });

  it('rejects missing periodLabel', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { periodLabel, ...rest } = validCreate;
    expect(CreateDonationPeriodSchema.safeParse(rest).success).toBe(false);
  });

  it('defaults enabled to true when omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enabled, ...rest } = validCreate;
    const result = CreateDonationPeriodSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(true);
  });

  it('defaults paymentSource to portal when omitted', () => {
    const result = CreateDonationPeriodSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paymentSource).toBe('portal');
  });

  it('accepts paymentSource legacy', () => {
    const result = CreateDonationPeriodSchema.safeParse({ ...validCreate, paymentSource: 'legacy' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.paymentSource).toBe('legacy');
  });

  it('rejects an unknown paymentSource', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, paymentSource: 'cash' }).success).toBe(false);
  });
});

describe('paymentSourceOf', () => {
  it('defaults to portal when unset (back-compat)', () => {
    expect(paymentSourceOf({ paymentSource: undefined })).toBe('portal');
  });
  it('returns the explicit source', () => {
    expect(paymentSourceOf({ paymentSource: 'legacy' })).toBe('legacy');
    expect(paymentSourceOf({ paymentSource: 'portal' })).toBe('portal');
  });
});

// ── UpdateDonationPeriodSchema ─────────────────────────────────────────────────

describe('UpdateDonationPeriodSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(UpdateDonationPeriodSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial update with only pricingTiers', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ pricingTiers: TIERS }).success).toBe(true);
  });

  it('accepts a partial update with only enabled toggle', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('rejects when both dates provided and endDate <= startDate', () => {
    expect(
      UpdateDonationPeriodSchema.safeParse({ startDate: FUTURE_END, endDate: FUTURE_START }).success,
    ).toBe(false);
  });

  it('rejects empty pricingTiers', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ pricingTiers: [] }).success).toBe(false);
  });

  it('rejects non-ascending pricingTiers', () => {
    expect(
      UpdateDonationPeriodSchema.safeParse({
        pricingTiers: [
          { effectiveFrom: '2027-12-01', amountCAD: 300, label: 'b' },
          { effectiveFrom: '2027-09-01', amountCAD: 500, label: 'a' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects empty periodLabel string', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ periodLabel: '' }).success).toBe(false);
  });
});

// ── DonationPeriodDocSchema ────────────────────────────────────────────────────

describe('DonationPeriodDocSchema', () => {
  const validDoc = {
    pid: 'bv-brampton-2027-28',
    programKey: 'bala-vihar' as const,
    programLabel: 'Bala Vihar',
    location: 'Brampton' as const,
    periodLabel: '2027-28',
    startDate: new Date(FUTURE_START),
    endDate: new Date(FUTURE_END),
    pricingTiers: TIERS,
    enabled: true,
    createdAt: new Date(),
    createdBy: 'uid-admin',
    updatedAt: new Date(),
    updatedBy: 'uid-admin',
  };

  it('accepts a valid period doc', () => {
    expect(DonationPeriodDocSchema.safeParse(validDoc).success).toBe(true);
  });

  it('accepts a doc with optional amountTiers present', () => {
    expect(DonationPeriodDocSchema.safeParse({ ...validDoc, amountTiers: [500, 750] }).success).toBe(true);
  });

  it('rejects missing pid', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pid, ...rest } = validDoc;
    expect(DonationPeriodDocSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty pricingTiers', () => {
    expect(DonationPeriodDocSchema.safeParse({ ...validDoc, pricingTiers: [] }).success).toBe(false);
  });
});

// ── resolveSuggestedAmount ─────────────────────────────────────────────────────

describe('resolveSuggestedAmount', () => {
  const period = { pricingTiers: TIERS as PricingTier[] };

  it('uses the first (full-year) tier before any window opens', () => {
    // 2027-08-01 (Toronto) — before the Sept tier
    expect(resolveSuggestedAmount(period, new Date('2027-08-01T17:00:00Z'))).toBe(500);
  });

  it('uses the full-year tier in September', () => {
    expect(resolveSuggestedAmount(period, new Date('2027-10-15T17:00:00Z'))).toBe(500);
  });

  it('uses the winter tier from December', () => {
    expect(resolveSuggestedAmount(period, new Date('2027-12-15T17:00:00Z'))).toBe(300);
  });

  it('uses the spring tier from February', () => {
    expect(resolveSuggestedAmount(period, new Date('2028-03-10T17:00:00Z'))).toBe(200);
  });

  it('applies a tier exactly on its effectiveFrom date', () => {
    expect(resolveSuggestedAmount(period, new Date('2027-12-01T17:00:00Z'))).toBe(300);
  });

  it('handles a single-tier schedule', () => {
    expect(
      resolveSuggestedAmount({ pricingTiers: [{ effectiveFrom: '2027-09-01', amountCAD: 450, label: 'flat' }] }, new Date('2028-01-01T17:00:00Z')),
    ).toBe(450);
  });
});
