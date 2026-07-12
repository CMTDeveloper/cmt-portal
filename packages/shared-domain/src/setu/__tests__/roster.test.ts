import { describe, it, expect } from 'vitest';
import {
  RosterQuerySchema,
  RosterFamilyRowSchema,
  RosterListResponseSchema,
  RosterPersonCsvRowSchema,
  MigrationStatusResponseSchema,
  ROSTER_PAYMENTS,
} from '../roster';

describe('roster schemas', () => {
  it('RosterQuerySchema defaults limit=50 and format=json, coerces numeric limit', () => {
    const parsed = RosterQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.format).toBe('json');
    expect(RosterQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('RosterQuerySchema accepts an admin-added centre (dynamic), rejects empty, and clamps limit to <=100', () => {
    expect(RosterQuerySchema.safeParse({ location: 'Toronto' }).success).toBe(true);
    expect(RosterQuerySchema.safeParse({ location: '' }).success).toBe(false);
    expect(RosterQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('RosterQuerySchema keeps a valid year and rejects a malformed one', () => {
    expect(RosterQuerySchema.parse({ year: '2025-26' }).year).toBe('2025-26');
    expect(RosterQuerySchema.parse({}).year).toBeUndefined();
    expect(RosterQuerySchema.safeParse({ year: '2025' }).success).toBe(false);
  });

  it('RosterFamilyRowSchema requires a known payment value and carries a nullable publicFid', () => {
    const row = {
      fid: 'CMT-X', publicFid: '1042', legacyFid: '123', name: 'Patel', location: 'Brampton',
      memberCount: 4, payment: 'paid', programs: ['Bala Vihar'],
    };
    expect(RosterFamilyRowSchema.parse(row).payment).toBe('paid');
    expect(RosterFamilyRowSchema.parse(row).publicFid).toBe('1042');
    // publicFid is nullable (not yet assigned during migration)
    expect(RosterFamilyRowSchema.parse({ ...row, publicFid: null }).publicFid).toBeNull();
    expect(RosterFamilyRowSchema.safeParse({ ...row, payment: 'maybe' }).success).toBe(false);
    expect(ROSTER_PAYMENTS).toContain('outstanding');
  });

  it('RosterFamilyRowSchema carries an optional, nullable bvEngagement (issue #23)', () => {
    const base = {
      fid: 'CMT-X', publicFid: '1042', legacyFid: '123', name: 'Patel', location: 'Brampton',
      memberCount: 4, payment: 'paid', programs: ['Bala Vihar'],
    };
    // confirmed / registered round-trip
    expect(RosterFamilyRowSchema.parse({ ...base, bvEngagement: 'confirmed' }).bvEngagement).toBe('confirmed');
    expect(RosterFamilyRowSchema.parse({ ...base, bvEngagement: 'registered' }).bvEngagement).toBe('registered');
    // null = no active BV enrollment
    expect(RosterFamilyRowSchema.parse({ ...base, bvEngagement: null }).bvEngagement).toBeNull();
    // absent is allowed (optional) and stays undefined
    expect(RosterFamilyRowSchema.parse(base).bvEngagement).toBeUndefined();
    // an unknown engagement value is rejected
    expect(RosterFamilyRowSchema.safeParse({ ...base, bvEngagement: 'maybe' }).success).toBe(false);
  });

  it('RosterListResponseSchema round-trips families + nullable cursor', () => {
    const resp = { families: [], nextCursor: null, total: 0 };
    expect(RosterListResponseSchema.parse(resp).nextCursor).toBeNull();
  });

  it('RosterPersonCsvRowSchema + MigrationStatusResponseSchema parse', () => {
    expect(RosterPersonCsvRowSchema.parse({
      familyName: 'Patel', fid: 'CMT-X', legacyFid: '123', memberName: 'Ravi Patel',
      type: 'Child', grade: '3', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid',
    }).type).toBe('Child');
    expect(MigrationStatusResponseSchema.parse({
      legacyTotal: 864, migrated: 800, missing: 64, missingFids: ['123'], checkedAt: '2026-06-09T00:00:00.000Z',
    }).missing).toBe(64);
  });
});
