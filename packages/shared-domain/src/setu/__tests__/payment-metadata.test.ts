import { describe, it, expect } from 'vitest';
import {
  buildClientReferenceId,
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

// ─────────────────────────────────────────────────────────────────────────────
// client_reference_id (2026-08-04)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildClientReferenceId', () => {
  it('puts the family FIRST, then the record', () => {
    expect(buildClientReferenceId({ familyLabel: 'FID-5006', recordId: 'U78VVE09p1jah98WUTj5' })).toBe(
      'FID-5006-U78VVE09p1jah98WUTj5',
    );
  });

  // The whole reason it is not simply the family id: a family makes many
  // payments, and this string is the only thing tying a Stripe row to one of
  // them. Losing either half defeats one of the two people who read it.
  it('keeps the record id intact, so a Stripe row still maps to one payment', () => {
    const ref = buildClientReferenceId({ familyLabel: 'FID-5006', recordId: 'abc123' });
    expect(ref.endsWith('abc123')).toBe(true);
    expect(ref).toContain('FID-5006');
  });

  // publicFid is minted lazily at first enrollment, so the very first payment a
  // family makes can race it and `paymentFamilyLabel` falls back to the internal
  // fid. Awkward, but it must still be unambiguous rather than blank.
  it('survives the pre-publicFid fallback label', () => {
    expect(buildClientReferenceId({ familyLabel: 'FID-CMT-SXO5QWFI', recordId: 'pid1' })).toBe(
      'FID-CMT-SXO5QWFI-pid1',
    );
  });

  it('stays far inside Stripe’s 200-character limit', () => {
    expect(buildClientReferenceId({ familyLabel: 'FID-CMT-SXO5QWFI', recordId: 'U78VVE09p1jah98WUTj5' }).length)
      .toBeLessThan(200);
  });
});
