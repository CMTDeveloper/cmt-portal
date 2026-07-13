import { describe, it, expect } from 'vitest';
import {
  bvOidForCenter,
  isBvOid,
  hasActiveEnrollmentForOid,
  priorYearBvEidsToCancel,
  type EnrollmentLite,
} from '../legacy-backfill-helpers';

describe('bvOidForCenter', () => {
  it('maps Scarborough to the Scarborough offering for the given year', () => {
    expect(bvOidForCenter('Scarborough', '2026-27')).toBe('bv-scarborough-2026-27');
  });
  it('maps Brampton (and every non-Scarborough center) to the Brampton offering', () => {
    expect(bvOidForCenter('Brampton', '2026-27')).toBe('bv-brampton-2026-27');
    expect(bvOidForCenter('Mississauga', '2026-27')).toBe('bv-brampton-2026-27');
    expect(bvOidForCenter('Markham', '2026-27')).toBe('bv-brampton-2026-27');
  });
});

describe('isBvOid', () => {
  it('is true only for bv- prefixed offering ids', () => {
    expect(isBvOid('bv-brampton-2026-27')).toBe(true);
    expect(isBvOid('tabla-brampton-2026-27')).toBe(false);
    expect(isBvOid(undefined)).toBe(false);
    expect(isBvOid(null)).toBe(false);
  });
});

describe('hasActiveEnrollmentForOid', () => {
  const rows: EnrollmentLite[] = [
    { oid: 'bv-brampton-2026-27', eid: 'F-bv-brampton-2026-27', status: 'active' },
    { oid: 'bv-brampton-2025-26', eid: 'F-bv-brampton-2025-26', status: 'cancelled' },
  ];
  it('is true when an active enrollment exists for the target oid', () => {
    expect(hasActiveEnrollmentForOid(rows, 'bv-brampton-2026-27')).toBe(true);
  });
  it('is false when the only match is cancelled', () => {
    expect(hasActiveEnrollmentForOid(rows, 'bv-brampton-2025-26')).toBe(false);
  });
  it('is false when no enrollment matches the oid', () => {
    expect(hasActiveEnrollmentForOid(rows, 'bv-scarborough-2026-27')).toBe(false);
  });
});

describe('priorYearBvEidsToCancel', () => {
  it('returns active BV enrollments whose oid differs from the current one', () => {
    const rows: EnrollmentLite[] = [
      { oid: 'bv-brampton-2025-26', eid: 'F-bv-brampton-2025-26', status: 'active' }, // cancel
      { oid: 'bv-brampton-2026-27', eid: 'F-bv-brampton-2026-27', status: 'active' }, // current -> keep
      { oid: 'bv-brampton-2024-25', eid: 'F-bv-brampton-2024-25', status: 'cancelled' }, // already cancelled -> skip
      { oid: 'tabla-brampton-2025-26', eid: 'F-tabla', status: 'active' }, // non-BV -> keep
    ];
    expect(priorYearBvEidsToCancel(rows, 'bv-brampton-2026-27')).toEqual(['F-bv-brampton-2025-26']);
  });
  it('returns empty when there are no stale prior-year BV enrollments', () => {
    expect(priorYearBvEidsToCancel([{ oid: 'bv-brampton-2026-27', eid: 'X', status: 'active' }], 'bv-brampton-2026-27')).toEqual([]);
  });
});
