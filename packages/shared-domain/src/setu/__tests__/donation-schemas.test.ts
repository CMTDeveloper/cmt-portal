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
  it('accepts a valid enrollment checkout', () => {
    const r = CheckoutInputSchema.safeParse({ type: 'enrollment', eid: 'fid1-oid1', amountCAD: 500 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coverFee).toBe(false); // default
  });

  it('REFUSES a general checkout — the type was removed 2026-08-03', () => {
    // The UI had already been withdrawn (CMT decision 2026-06-04: /family/donate
    // redirects home on mode==='general'), but the ROUTE still accepted it. An
    // authenticated manager hand-POSTing this could still mint a real Stripe
    // checkout, under a campaign nobody had defined. A dead branch that can
    // still take money is not dead.
    expect(CheckoutInputSchema.safeParse({ type: 'general', amountCAD: 100, coverFee: true }).success).toBe(false);
  });

  it('rejects enrollment without eid', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'enrollment', amountCAD: 500 }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'building-fund', amountCAD: 500 }).success).toBe(false);
  });

  it('rejects non-integer amounts', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'enrollment', eid: 'e1', amountCAD: 50.5 }).success).toBe(false);
  });

  it('rejects amount < 1', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'enrollment', eid: 'e1', amountCAD: 0 }).success).toBe(false);
  });

  it('rejects amount above the 100000 cap', () => {
    expect(CheckoutInputSchema.safeParse({ type: 'enrollment', eid: 'e1', amountCAD: 100001 }).success).toBe(false);
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
    type: 'enrollment' as const,
    programKey: null,
    programLabel: null,
    pid: null,
    eid: null,
    label: 'Bala Vihar Donation — 2026-27',
    amountCAD: 100,
    coverFee: false,
    feeCAD: 0,
    clientReferenceId: 'SETU-GD',
    status: 'redirected' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('still READS a doc with null program fields — production has them on file', () => {
    expect(DonationDocSchema.safeParse(valid).success).toBe(true);
  });

  it('STILL READS a retired general donation — narrowing the enum would orphan them', () => {
    // The write path no longer accepts `type:'general'`, but documents carrying
    // it are in production from before the UI was withdrawn. A doc schema
    // validates on READ; tightening this enum would make every one of them fail
    // to parse, and the family's own donation history would 500.
    const legacyGeneral = { ...valid, type: 'general' as const, label: 'General Donation — Chinmaya Mission Toronto' };
    expect(DonationDocSchema.safeParse(legacyGeneral).success).toBe(true);
  });

  it('accepts an enrollment doc with program + pid + eid set', () => {
    const r = DonationDocSchema.safeParse({
      ...valid,
      type: 'enrollment',
      programKey: 'tabla',
      programLabel: 'Tabla classes',
      pid: 'tabla-brampton-2026-27',
      eid: 'fid1-tabla-brampton-2026-27',
      label: 'Tabla classes Donation — 2026-27',
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
  it('names an enrollment gift with the program + term', () => {
    expect(checkoutLineItemName('enrollment', { programLabel: 'Bala Vihar', termLabel: 'Fall 2026' })).toBe('Bala Vihar Donation — Fall 2026');
  });

  it('names a non-BV program gift after its own program', () => {
    expect(checkoutLineItemName('enrollment', { programLabel: 'Tabla classes', termLabel: '2026-27' })).toBe('Tabla classes Donation — 2026-27');
  });

  it('names an enrollment gift without a term label', () => {
    expect(checkoutLineItemName('enrollment', { programLabel: 'Bala Vihar' })).toBe('Bala Vihar Donation');
  });

  it('falls back to "Program" when the program label is missing', () => {
    expect(checkoutLineItemName('enrollment')).toBe('Program Donation');
  });
});
