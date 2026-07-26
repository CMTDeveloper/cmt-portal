import { describe, it, expect } from 'vitest';
import {
  RosterPersonCsvRowSchema,
  MigrationStatusResponseSchema,
  ROSTER_PAYMENTS,
} from '../roster';

describe('roster schemas', () => {
  it('ROSTER_PAYMENTS covers the three payment states', () => {
    expect(ROSTER_PAYMENTS).toContain('paid');
    expect(ROSTER_PAYMENTS).toContain('outstanding');
    expect(ROSTER_PAYMENTS).toContain('unknown');
  });

  it('RosterPersonCsvRowSchema parses a person row incl. the level column', () => {
    const parsed = RosterPersonCsvRowSchema.parse({
      familyName: 'Patel', fid: 'CMT-X', legacyFid: '123', memberName: 'Ravi Patel',
      type: 'Child', grade: '3', level: 'Level 3', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid',
    });
    expect(parsed.type).toBe('Child');
    expect(parsed.level).toBe('Level 3');
    // level is required (the single-page report + reports enrollment CSV share this shape).
    expect(RosterPersonCsvRowSchema.safeParse({
      familyName: 'Patel', fid: 'CMT-X', legacyFid: '123', memberName: 'Ravi Patel',
      type: 'Child', grade: '3', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid',
    }).success).toBe(false);
  });

  it('MigrationStatusResponseSchema parses', () => {
    expect(MigrationStatusResponseSchema.parse({
      legacyTotal: 864, migrated: 800, missing: 64, missingFids: ['123'], skippedDormant: 0,
      checkedAt: '2026-06-09T00:00:00.000Z',
    }).missing).toBe(64);
  });

  it('MigrationStatusResponseSchema requires skippedDormant', () => {
    // Required, not optional-with-default: this is a RESPONSE schema, and a
    // default would let a server that forgot to compute the count report a
    // confident 0 - which reads as "no families were skipped" when the truth is
    // "nobody looked".
    expect(MigrationStatusResponseSchema.safeParse({
      legacyTotal: 1, migrated: 1, missing: 0, missingFids: [], checkedAt: 'x',
    }).success).toBe(false);
  });
});
