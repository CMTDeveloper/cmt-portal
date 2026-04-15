import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';

export type CsvRow = TeacherReportEntry;

const HEADERS: Array<keyof CsvRow> = [
  'date',
  'classId',
  'sid',
  'firstName',
  'lastName',
  'status',
];

function escapeField(v: string): string {
  if (v.includes('"') || v.includes(',') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function toCsv(rows: CsvRow[]): string {
  const header = HEADERS.join(',');
  if (rows.length === 0) return header;
  const body = rows
    .map((row) => HEADERS.map((h) => escapeField(String(row[h]))).join(','))
    .join('\n');
  return `${header}\n${body}`;
}
