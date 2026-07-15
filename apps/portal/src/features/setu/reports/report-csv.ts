// apps/portal/src/features/setu/reports/report-csv.ts
import type { EnrollmentReport, AttendanceReport } from '@cmt/shared-domain';
import { csvCell } from '@/lib/csv';

function table(headers: string[], rows: Array<Array<unknown>>): string {
  const head = headers.join(',');
  if (rows.length === 0) return head;
  // csvCell neutralizes spreadsheet formula injection (=,+,-,@,tab,cr) in
  // user-controlled cells (program/level labels) on top of CSV quoting.
  return `${head}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
}

export function enrollmentReportToCsv(r: EnrollmentReport): string {
  return table(['scope', 'key', 'label', 'families', 'members'], [
    ...r.byProgram.map((p) => ['program', p.programKey, p.programLabel, p.families, p.members]),
    ...r.byLevel.map((l) => ['level', l.levelId, l.levelName, '', l.members]),
  ]);
}

export function attendanceReportToCsv(r: AttendanceReport): string {
  return table(['scope', 'key', 'label', 'present', 'absent', 'total', 'rate'], [
    ...r.byLevel.map((l) => ['level', l.levelId, l.levelName, l.present, l.absent, l.total, l.rate.toFixed(3)]),
    ...r.byProgram.map((p) => ['program', p.programKey, p.programLabel, p.present, p.absent, p.total, p.rate.toFixed(3)]),
  ]);
}
