import type { RosterPersonCsvRow } from '@cmt/shared-domain/setu';

const HEADERS: Array<keyof RosterPersonCsvRow> = [
  'familyName', 'fid', 'legacyFid', 'memberName', 'type', 'grade', 'location', 'programs', 'payment',
];

function escapeField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rosterToCsv(rows: RosterPersonCsvRow[]): string {
  const header = HEADERS.join(',');
  if (rows.length === 0) return header;
  const body = rows.map((r) => HEADERS.map((h) => escapeField(String(r[h] ?? ''))).join(',')).join('\n');
  return `${header}\n${body}`;
}
