import { describe, it, expect } from 'vitest';
import {
  CheckoutInputSchema,
  DonationDocSchema,
  processingFeeCAD,
  checkoutLineItemName,
  STRIPE_PERCENT_FEE,
  STRIPE_FIXED_FEE,
} from '../schemas/donation';

// ── CheckoutInputSchema (discriminated union) ──────────────────────────────────

describe('CheckoutInputSchema', () => {
  it('accepts a valid bala-vihar checkout', () => {
    const r = CheckoutInputSchema.safeParse({ type: 'bala-vihar', eid: 'fid1-pid1', amountCAD: 500 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coverFee).toBe(false); // default
  });

  it('accepts a valid general checkout', () => {
    const r = CheckoutInputSchema.safeParse({ type: 'general', amountCAD: 100, coverFee: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coverFee).toBe(true);
  });

  it('rejects bala-vihar without eid', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'bala-vihar', amountCAD: 500 }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'building-fund', amountCAD: 500 }).success).toBe(false);
  });

  it('rejects non-integer amounts', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'general', amountCAD: 50.5 }).success).toBe(false);
  });

  it('rejects amount < 1', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'general', amountCAD: 0 }).success).toBe(false);
  });

  it('rejects amount above the 100000 cap', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'general', amountCAD: 100001 }).success).toBe(false);
  });
});

// ── DonationDocSchema ───────────────────────────────────────────────────────────

describe('DonationDocSchema', () => {
  const valid = {
    did: 'don_abc',
    fid: 'fid1',
    donorMid: 'fid1-01',
    donorName: 'Raj Patel',
    donorEmail: 'raj@example.com',
    type: 'general' as const,
    pid: null,
    eid: null,
    label: 'General Donation — Chinmaya Mission Toronto',
    amountCAD: 100,
    coverFee: false,
    feeCAD: 0,
    clientReferenceId: 'SETU-GD',
    status: 'redirected' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts a valid general donation doc', () => {
    expect(DonationDocSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a bala-vihar doc with pid + eid set', () => {
    const r = DonationDocSchema.safeParse({
      ...valid,
      type: 'bala-vihar',
      pid: 'bala-vihar-brampton-fall-2026',
      eid: 'fid1-bala-vihar-brampton-fall-2026',
      label: 'Bala Vihar Donation — Fall 2026',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid donor email', () => {
    expect(DonationDocSchema.safeParse({ ...valid, donorEmail: 'not-an-email' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(DonationDocSchema.safeParse({ ...valid, status: 'paid' }).success).toBe(false);
  });
});

// ── processingFeeCAD ────────────────────────────────────────────────────────────

describe('processingFeeCAD', () => {
  it('computes 2.2% + $0.30 rounded to cents', () => {
    // 500 * 0.022 + 0.30 = 11.30
    expect(processingFeeCAD(500)).toBe(11.3);
    // 100 * 0.022 + 0.30 = 2.50
    expect(processingFeeCAD(100)).toBe(2.5);
  });

  it('uses the shared constants', () => {
    expect(STRIPE_PERCENT_FEE).toBe(0.022);
    expect(STRIPE_FIXED_FEE).toBe(0.3);
  });
});

// ── checkoutLineItemName ────────────────────────────────────────────────────────

describe('checkoutLineItemName', () => {
  it('names a bala-vihar gift with the period label', () => {
    expect(checkoutLineItemName('bala-vihar', 'Fall 2026')).toBe('Bala Vihar Donation — Fall 2026');
  });

  it('names a bala-vihar gift without a period label', () => {
    expect(checkoutLineItemName('bala-vihar')).toBe('Bala Vihar Donation');
  });

  it('names a general gift', () => {
    expect(checkoutLineItemName('general')).toBe('General Donation — Chinmaya Mission Toronto');
  });
});
