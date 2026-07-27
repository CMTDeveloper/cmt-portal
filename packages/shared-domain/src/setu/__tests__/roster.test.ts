import { describe, it, expect } from 'vitest';
import {
  RosterPersonCsvRowSchema,
  MigrationStatusResponseSchema,
  ROSTER_PAYMENTS,
} from '../roster';

describe('roster schemas', () => {
  // Asserted as an exact list, not with toContain: a state silently dropped from
  // the enum would still pass three toContain calls, and every consumer that maps
  // over ROSTER_PAYMENTS (the roster's Payment filter, the report route's
  // validator) would quietly lose an option.
  it('ROSTER_PAYMENTS is exactly the four payment states', () => {
    expect([...ROSTER_PAYMENTS]).toEqual(['paid', 'outstanding', 'not-applicable', 'unknown']);
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
