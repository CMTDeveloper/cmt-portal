import { describe, it, expect } from 'vitest';
import {
  buildPaymentMetadata,
  campaignForProgram,
  hasNamedCampaign,
  CAMPAIGN_PLEDGE,
  CAMPAIGN_FALLBACK,
  PAYMENT_SOURCE,
} from '../payment-metadata';

// The values below are copied VERBATIM from CMT's "Stripe Integration Doc"
// (§1 one-time donation, §2 monthly PAD). Asserting the literals is the point:
// `campaign` and `source` are adjacent string fields, and the portal previously
// put the SOURCE ('setu') into the CAMPAIGN field — so the campaign was never
// populated and the source was never sent, on every live payment. Nothing about
// that fails loudly; the report just comes out wrong.
describe('buildPaymentMetadata — the contract from the integration doc', () => {
  it('sends campaign=BalaViharDonation + source=setu on a Bala Vihar donation', () => {
    const m = buildPaymentMetadata({
      kind: 'donation',
      fid: 'CMT-HTNO0TEG',
      familyId: 'FID-5001',
      programKey: 'bala-vihar',
    });
    expect(m.campaign).toBe('BalaViharDonation');
    expect(m.source).toBe('setu');
    // NOT the other way round, which is exactly what shipped.
    expect(m.campaign).not.toBe('setu');
  });

  it('sends campaign=BalaViharPledge + source=setu on the monthly PAD', () => {
    const m = buildPaymentMetadata({
      kind: 'pledge',
      fid: 'CMT-HTNO0TEG',
      familyId: 'FID-5001',
      pid: 'PLG-1',
    });
    expect(m.campaign).toBe('BalaViharPledge');
    expect(m.source).toBe('setu');
    expect(m.pid).toBe('PLG-1');
  });

  it('keeps both family identifiers on BOTH paths', () => {
    // `fid` is the join key support and reconciliation match on; `familyId` is
    // the human-readable form asked for after a live Stripe record turned out to
    // be identified only by "CMT-HTNO0TEG". One family must look the same on
    // both payment paths.
    const donation = buildPaymentMetadata({ kind: 'donation', fid: 'CMT-X', familyId: 'FID-5001', programKey: 'bala-vihar' });
    const pledge = buildPaymentMetadata({ kind: 'pledge', fid: 'CMT-X', familyId: 'FID-5001', pid: 'PLG-1' });
    expect(donation.fid).toBe('CMT-X');
    expect(donation.familyId).toBe('FID-5001');
    expect(pledge.fid).toBe('CMT-X');
    expect(pledge.familyId).toBe('FID-5001');
  });

  it('every value is a string — Stripe metadata takes nothing else', () => {
    const m = buildPaymentMetadata({ kind: 'donation', fid: 'CMT-X', familyId: 'FID-5001', programKey: null });
    expect(Object.values(m).every((v) => typeof v === 'string')).toBe(true);
  });
});

describe('campaignForProgram — a gift CMT has not named a campaign for', () => {
  it('never labels a non-Bala-Vihar gift as Bala Vihar', () => {
    // The silent-misfiling case. A Tabla donation stamped BalaViharDonation
    // lands in the wrong report and NOBODY reconciling either one sees a
    // discrepancy - it simply looks like Bala Vihar took more than it did.
    expect(campaignForProgram('tabla')).not.toBe('BalaViharDonation');
    expect(campaignForProgram('tabla')).toBe(CAMPAIGN_FALLBACK);
    expect(campaignForProgram('gita')).toBe(CAMPAIGN_FALLBACK);
    expect(campaignForProgram(null)).toBe(CAMPAIGN_FALLBACK);
  });

  it('does NOT refuse the payment', () => {
    // The other direction, and it matters just as much: `paymentSourceOf()`
    // defaults an offering with no explicit paymentSource to 'portal', so a
    // non-Bala-Vihar offering is payable through the portal today. Throwing
    // here would stop a family giving money CMT wants, with nothing they could
    // do about it. A fallback campaign is recoverable; a refusal is not.
    expect(() => campaignForProgram('tabla')).not.toThrow();
    expect(campaignForProgram('tabla')).toBeTruthy();
  });

  it('carries the real programKey alongside, so the truth is never lost', () => {
    const m = buildPaymentMetadata({ kind: 'donation', fid: 'CMT-X', familyId: 'FID-5001', programKey: 'tabla' });
    expect(m.programKey).toBe('tabla');
    expect(m.campaign).toBe(CAMPAIGN_FALLBACK);
  });

  it('says plainly which programs have a campaign CMT has actually named', () => {
    expect(hasNamedCampaign('bala-vihar')).toBe(true);
    expect(hasNamedCampaign('tabla')).toBe(false);
    expect(hasNamedCampaign(null)).toBe(false);
  });
});

describe('the constants themselves', () => {
  it('are the literals from the doc', () => {
    expect(PAYMENT_SOURCE).toBe('setu');
    expect(CAMPAIGN_PLEDGE).toBe('BalaViharPledge');
  });
});
