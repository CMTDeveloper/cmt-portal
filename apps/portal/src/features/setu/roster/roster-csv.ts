import type { RosterPersonCsvRow } from '@cmt/shared-domain/setu';
import { csvCell } from '@/lib/csv';

const HEADERS: Array<keyof RosterPersonCsvRow> = [
  'familyName', 'fid', 'legacyFid', 'memberName', 'type', 'grade', 'level', 'location', 'programs', 'payment',
];

export function rosterToCsv(rows: RosterPersonCsvRow[]): string {
  const header = HEADERS.join(',');
  if (rows.length === 0) return header;
  // csvCell neutralizes spreadsheet formula injection (=,+,-,@,tab,cr) in
  // user-controlled cells (family/member names) on top of CSV quoting.
  const body = rows.map((r) => HEADERS.map((h) => csvCell(r[h] ?? '')).join(',')).join('\n');
  return `${header}\n${body}`;
}
