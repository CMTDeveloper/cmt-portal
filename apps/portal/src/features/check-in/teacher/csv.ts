import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';
import { csvRow } from '@/lib/csv';

export type CsvRow = TeacherReportEntry;

const HEADERS: Array<keyof CsvRow> = [
  'date',
  'classId',
  'sid',
  'firstName',
  'lastName',
  'status',
];

export function toCsv(rows: CsvRow[]): string {
  // csvRow neutralizes spreadsheet formula injection (leading = + - @ / TAB / CR)
  // in addition to CSV quoting — student names come from family-entered data.
  const header = csvRow(HEADERS);
  if (rows.length === 0) return header;
  const body = rows.map((row) => csvRow(HEADERS.map((h) => row[h]))).join('\n');
  return `${header}\n${body}`;
}
