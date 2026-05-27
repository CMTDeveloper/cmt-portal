import { describe, it, expect } from 'vitest';
import {
  CreateDonationPeriodSchema,
  UpdateDonationPeriodSchema,
  DonationPeriodDocSchema,
} from '../schemas/donation-period';

const FUTURE_START = '2027-09-01T04:00:00.000Z';
const FUTURE_END = '2027-12-31T04:59:59.000Z';

const validCreate = {
  programKey: 'bala-vihar' as const,
  location: 'Brampton' as const,
  periodLabel: 'Fall 2027',
  startDate: FUTURE_START,
  endDate: FUTURE_END,
  suggestedAmount: 500,
  amountTiers: [500, 750, 1000],
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

  it('rejects suggestedAmount of 0', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, suggestedAmount: 0 }).success).toBe(false);
  });

  it('rejects negative suggestedAmount', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, suggestedAmount: -100 }).success).toBe(false);
  });

  it('rejects non-integer suggestedAmount', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, suggestedAmount: 500.5 }).success).toBe(false);
  });

  it('rejects empty amountTiers array', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, amountTiers: [] }).success).toBe(false);
  });

  it('rejects amountTiers with a zero entry', () => {
    expect(CreateDonationPeriodSchema.safeParse({ ...validCreate, amountTiers: [0, 500] }).success).toBe(false);
  });

  it('rejects endDate equal to startDate', () => {
    expect(
      CreateDonationPeriodSchema.safeParse({ ...validCreate, endDate: FUTURE_START }).success,
    ).toBe(false);
  });

  it('rejects endDate before startDate', () => {
    expect(
      CreateDonationPeriodSchema.safeParse({
        ...validCreate,
        startDate: FUTURE_END,
        endDate: FUTURE_START,
      }).success,
    ).toBe(false);
  });

  it('rejects missing periodLabel', () => {
    const { periodLabel: _periodLabel, ...rest } = validCreate;
    expect(CreateDonationPeriodSchema.safeParse(rest).success).toBe(false);
  });

  it('defaults enabled to true when omitted', () => {
    const { enabled: _enabled, ...rest } = validCreate;
    const result = CreateDonationPeriodSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(true);
  });

  it('accepts enabled: false explicitly', () => {
    const result = CreateDonationPeriodSchema.safeParse({ ...validCreate, enabled: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(false);
  });
});

// ── UpdateDonationPeriodSchema ─────────────────────────────────────────────────

describe('UpdateDonationPeriodSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(UpdateDonationPeriodSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial update with only suggestedAmount', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ suggestedAmount: 750 }).success).toBe(true);
  });

  it('accepts a partial update with only enabled toggle', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('accepts a partial update with both dates when endDate > startDate', () => {
    expect(
      UpdateDonationPeriodSchema.safeParse({
        startDate: FUTURE_START,
        endDate: FUTURE_END,
      }).success,
    ).toBe(true);
  });

  it('rejects when both dates provided and endDate <= startDate', () => {
    expect(
      UpdateDonationPeriodSchema.safeParse({
        startDate: FUTURE_END,
        endDate: FUTURE_START,
      }).success,
    ).toBe(false);
  });

  it('allows updating only startDate (single-side date update)', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ startDate: FUTURE_START }).success).toBe(true);
  });

  it('allows updating only endDate', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ endDate: FUTURE_END }).success).toBe(true);
  });

  it('rejects suggestedAmount of 0', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ suggestedAmount: 0 }).success).toBe(false);
  });

  it('rejects empty amountTiers', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ amountTiers: [] }).success).toBe(false);
  });

  it('rejects empty periodLabel string', () => {
    expect(UpdateDonationPeriodSchema.safeParse({ periodLabel: '' }).success).toBe(false);
  });
});

// ── DonationPeriodDocSchema ────────────────────────────────────────────────────

describe('DonationPeriodDocSchema', () => {
  const validDoc = {
    pid: 'bala-vihar-brampton-fall-2027',
    programKey: 'bala-vihar' as const,
    programLabel: 'Bala Vihar',
    location: 'Brampton' as const,
    periodLabel: 'Fall 2027',
    startDate: new Date(FUTURE_START),
    endDate: new Date(FUTURE_END),
    suggestedAmount: 500,
    amountTiers: [500, 750, 1000],
    enabled: true,
    createdAt: new Date(),
    createdBy: 'uid-admin',
    updatedAt: new Date(),
    updatedBy: 'uid-admin',
  };

  it('accepts a valid period doc', () => {
    expect(DonationPeriodDocSchema.safeParse(validDoc).success).toBe(true);
  });

  it('rejects missing pid', () => {
    const { pid: _pid, ...rest } = validDoc;
    expect(DonationPeriodDocSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing createdBy', () => {
    const { createdBy: _createdBy, ...rest } = validDoc;
    expect(DonationPeriodDocSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects suggestedAmount of 0', () => {
    expect(DonationPeriodDocSchema.safeParse({ ...validDoc, suggestedAmount: 0 }).success).toBe(false);
  });
});
