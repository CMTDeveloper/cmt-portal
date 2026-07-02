import { describe, it, expect } from 'vitest';
import { isEnrollmentConfirmed } from '../_helpers/enrollment-confirmation';
import type { DonationDoc } from '@cmt/shared-domain';

const bv = { eid: 'FAM1-bv-brampton-2026-27' };

// House-style fixture (mirrors makeDonation in dashboard-model.test.ts): a
// partial object cast to DonationDoc. Defaults to a completed BV donation.
function donation(over: Partial<DonationDoc> = {}): DonationDoc {
  return {
    fid: 'FAM1',
    type: 'enrollment',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    pid: null,
    eid: 'FAM1-bv-brampton-2026-27',
    label: 'Bala Vihar Donation — 2026-27',
    amountCAD: 25,
    status: 'completed',
    createdAt: new Date('2026-05-30'),
    createdBy: 'FAM1-01',
    updatedAt: new Date('2026-05-30'),
    updatedBy: 'FAM1-01',
    ...over,
  } as DonationDoc;
}

describe('isEnrollmentConfirmed', () => {
  it('attendance alone confirms', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 1, donations: [], legacyPaid: false })).toBe(true);
  });
  it('a completed donation for this eid alone confirms (any amount)', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [donation({})], legacyPaid: false })).toBe(true);
  });
  it('legacyPaid alone confirms', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [], legacyPaid: true })).toBe(true);
  });
  it('neither → not confirmed', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [], legacyPaid: false })).toBe(false);
  });
  it('a donation to a DIFFERENT enrollment (e.g. Tabla) does NOT confirm', () => {
    const tabla = { ...donation({}), eid: 'FAM1-tabla-brampton-2026-27' } as DonationDoc;
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [tabla], legacyPaid: false })).toBe(false);
  });
  it('a pending/abandoned donation does NOT confirm', () => {
    const pending = { ...donation({}), status: 'abandoned' } as DonationDoc;
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [pending], legacyPaid: false })).toBe(false);
  });
  it('a donation with eid null (general giving) does NOT confirm', () => {
    const general = { ...donation({}), eid: null } as DonationDoc;
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [general], legacyPaid: false })).toBe(false);
  });
});
