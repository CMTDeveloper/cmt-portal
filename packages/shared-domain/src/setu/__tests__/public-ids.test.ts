import { describe, it, expect } from 'vitest';
import { displayFid, displayMid, paymentFamilyLabel } from '../public-ids';

describe('public-id display helpers', () => {
  it('prefers the public id when present', () => {
    expect(displayFid({ publicFid: '1042', fid: 'CMT-A1B2C3D4' })).toBe('1042');
    expect(displayMid({ publicMid: '50001', mid: 'CMT-A1B2C3D4-01' })).toBe('50001');
  });
  it('falls back to the legacy id when the public id is null/absent', () => {
    expect(displayFid({ publicFid: null, fid: 'CMT-A1B2C3D4' })).toBe('CMT-A1B2C3D4');
    expect(displayFid({ fid: 'CMT-A1B2C3D4' })).toBe('CMT-A1B2C3D4');
    expect(displayMid({ mid: 'CMT-A1B2C3D4-01' })).toBe('CMT-A1B2C3D4-01');
  });
});

describe('paymentFamilyLabel', () => {
  it('prefixes the public Family ID for an external payment record', () => {
    expect(paymentFamilyLabel({ publicFid: '5001', fid: 'CMT-HTNO0TEG' })).toBe('FID-5001');
  });

  it('still identifies the family before a publicFid is minted', () => {
    // publicFid is allocated lazily at first enrollment, so a donation can be
    // made without one. An awkward label beats an absent one.
    expect(paymentFamilyLabel({ publicFid: null, fid: 'CMT-HTNO0TEG' })).toBe('FID-CMT-HTNO0TEG');
    expect(paymentFamilyLabel({ fid: 'CMT-HTNO0TEG' })).toBe('FID-CMT-HTNO0TEG');
  });

  it('is never a bare number, which is what made the raw id ambiguous', () => {
    // In Stripe's flat metadata table "5001" alone reads as an amount or an
    // invoice number; the prefix is what makes the value self-describing.
    expect(paymentFamilyLabel({ publicFid: '5001', fid: 'CMT-X' })).not.toBe('5001');
    expect(paymentFamilyLabel({ publicFid: '5001', fid: 'CMT-X' })).toMatch(/^FID-/);
  });
});
