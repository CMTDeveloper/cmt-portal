import { describe, it, expect } from 'vitest';
import { toCsv, type CsvRow } from '../csv';

describe('toCsv', () => {
  it('serializes headers + rows', () => {
    const rows: CsvRow[] = [
      { date: '2026-04-13', classId: 'K', sid: '1', firstName: 'Alice', lastName: 'Acme', status: 'present' },
      { date: '2026-04-13', classId: 'K', sid: '2', firstName: 'Bob', lastName: 'Bravo', status: 'absent' },
    ];
    const csv = toCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('date,classId,sid,firstName,lastName,status');
    expect(lines[1]).toBe('2026-04-13,K,1,Alice,Acme,present');
    expect(lines[2]).toBe('2026-04-13,K,2,Bob,Bravo,absent');
  });

  it('escapes commas and quotes', () => {
    const rows: CsvRow[] = [
      { date: '2026-04-13', classId: 'K', sid: '1', firstName: 'Al, "Ace"', lastName: 'Acme', status: 'present' },
    ];
    const csv = toCsv(rows);
    expect(csv).toContain('"Al, ""Ace"""');
  });

  it('returns just headers for empty rows', () => {
    const csv = toCsv([]);
    expect(csv).toBe('date,classId,sid,firstName,lastName,status');
  });
});
