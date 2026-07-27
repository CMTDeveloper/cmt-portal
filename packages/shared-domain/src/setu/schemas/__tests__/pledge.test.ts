import { describe, it, expect } from 'vitest';
import { PledgeDocSchema, PLEDGE_STATUSES, isPledgeGiving } from '../pledge';

/**
 * The pledge record is STATUS ONLY. The portal never sees a bank detail, a card
 * number or a mandate - those live entirely at Stripe, behind the hosted page.
 * The tests below are as much about what the schema must REFUSE to carry as
 * about what it accepts.
 */

const base = {
  pid: 'PLG-1',
  fid: 'CMT-A',
  monthlyAmountCAD: 51,
  status: 'started' as const,
  startedAt: new Date('2026-08-03T12:00:00Z'),
  activatedAt: null,
  cancelledAt: null,
  startedByMid: 'CMT-A-01',
};

describe('PledgeDocSchema', () => {
  it('parses a freshly started pledge with no provider handles yet', () => {
    const parsed = PledgeDocSchema.parse(base);
    expect(parsed.status).toBe('started');
    expect(parsed.monthlyAmountCAD).toBe(51);
  });

  it('accepts the opaque Stripe handles once they exist', () => {
    const parsed = PledgeDocSchema.parse({
      ...base,
      status: 'active',
      activatedAt: new Date('2026-08-05T12:00:00Z'),
      setupSessionId: 'cs_test_123',
      subscriptionId: 'sub_123',
      customerId: 'cus_123',
      lastCheckedAt: new Date('2026-08-05T12:00:00Z'),
      lastError: null,
    });
    expect(parsed.subscriptionId).toBe('sub_123');
  });

  it('rejects a status outside the vocabulary', () => {
    expect(() => PledgeDocSchema.parse({ ...base, status: 'pending' })).toThrow();
    expect(() => PledgeDocSchema.parse({ ...base, status: 'paused' })).toThrow();
  });

  it('exposes exactly four statuses, and NOT `pending`', () => {
    // `started` means "we redirected them and do not yet know what happened".
    // `pending` overstates it - it reads as "in progress and on track", which is
    // a claim nothing has verified.
    expect([...PLEDGE_STATUSES]).toEqual(['started', 'active', 'cancelled', 'failed']);
  });

  it('validates on READ: a doc written before the handle fields existed still parses', () => {
    // Doc schemas run against whatever is already in Firestore. A bare
    // `.optional()` (never `.default()`) is what lets an older doc through
    // without the schema inventing a value that was never written.
    expect(() => PledgeDocSchema.parse(base)).not.toThrow();
    const parsed = PledgeDocSchema.parse(base);
    expect('setupSessionId' in parsed).toBe(false);
  });

  it('accepts null handles distinctly from absent ones', () => {
    const parsed = PledgeDocSchema.parse({ ...base, setupSessionId: null, subscriptionId: null });
    expect(parsed.setupSessionId).toBeNull();
  });

  it('requires a positive integer amount', () => {
    expect(() => PledgeDocSchema.parse({ ...base, monthlyAmountCAD: 0 })).toThrow();
    expect(() => PledgeDocSchema.parse({ ...base, monthlyAmountCAD: -51 })).toThrow();
    expect(() => PledgeDocSchema.parse({ ...base, monthlyAmountCAD: 51.5 })).toThrow();
  });

  it('STRIPS any bank-ish field rather than storing it', () => {
    // The single most important property of this record. Zod objects are
    // strip-by-default, so an accidental spread of a Stripe response into the
    // doc cannot smuggle account details past the schema. This asserts that
    // default is actually in force rather than assumed.
    const parsed = PledgeDocSchema.parse({
      ...base,
      accountNumber: '000123456789',
      institutionNumber: '001',
      transitNumber: '12345',
      last4: '6789',
      mandate: 'mandate_abc',
    }) as Record<string, unknown>;
    for (const leaked of ['accountNumber', 'institutionNumber', 'transitNumber', 'last4', 'mandate']) {
      expect(parsed[leaked], `${leaked} must never survive into a pledge doc`).toBeUndefined();
    }
  });
});

describe('isPledgeGiving', () => {
  it('is true ONLY for active', () => {
    // `started` is the trap: the family has been to the hosted page but nothing
    // has confirmed a mandate, so any UI claiming they are giving would be a
    // lie. The card copy depends on this being narrow.
    expect(isPledgeGiving({ status: 'active' })).toBe(true);
    expect(isPledgeGiving({ status: 'started' })).toBe(false);
    expect(isPledgeGiving({ status: 'failed' })).toBe(false);
    expect(isPledgeGiving({ status: 'cancelled' })).toBe(false);
    expect(isPledgeGiving(null)).toBe(false);
    expect(isPledgeGiving(undefined)).toBe(false);
  });
});
