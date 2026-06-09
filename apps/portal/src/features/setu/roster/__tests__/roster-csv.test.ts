import { describe, it, expect } from 'vitest';
import { rosterToCsv } from '../roster-csv';
import type { RosterPersonCsvRow } from '@cmt/shared-domain/setu';

const row = (over: Partial<RosterPersonCsvRow>): RosterPersonCsvRow => ({
  familyName: 'Patel', fid: 'CMT-X', legacyFid: '123', memberName: 'Ravi Patel',
  type: 'Child', grade: '3', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid', ...over,
});

describe('rosterToCsv', () => {
  it('emits a header row even with no data', () => {
    expect(rosterToCsv([])).toMatch(/^familyName,fid,legacyFid,memberName,type,grade,location,programs,payment$/);
  });

  it('emits one row per person with all columns in order', () => {
    const csv = rosterToCsv([row({ memberName: 'Ravi Patel' }), row({ memberName: 'Mira Patel', type: 'Adult', grade: '' })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[1]).toContain('Ravi Patel');
    expect(lines[2]).toContain('Mira Patel');
  });

  it('escapes commas, quotes, and newlines', () => {
    const csv = rosterToCsv([row({ familyName: 'Patel, Jr "the elder"' })]);
    expect(csv).toContain('"Patel, Jr ""the elder"""');
  });
});
