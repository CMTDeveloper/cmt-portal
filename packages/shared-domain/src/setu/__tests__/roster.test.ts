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

  it('RosterQuerySchema rejects an unknown location and clamps limit to <=100', () => {
    expect(RosterQuerySchema.safeParse({ location: 'Toronto' }).success).toBe(false);
    expect(RosterQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('RosterFamilyRowSchema requires a known payment value', () => {
    const row = {
      fid: 'CMT-X', legacyFid: '123', name: 'Patel', location: 'Brampton',
      memberCount: 4, payment: 'paid', programs: ['Bala Vihar'],
    };
    expect(RosterFamilyRowSchema.parse(row).payment).toBe('paid');
    expect(RosterFamilyRowSchema.safeParse({ ...row, payment: 'maybe' }).success).toBe(false);
    expect(ROSTER_PAYMENTS).toContain('outstanding');
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
