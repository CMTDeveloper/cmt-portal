import { NextResponse } from 'next/server';
import {
  isWelcomeTeam,
  ReportQuerySchema,
  REPORT_KINDS,
  type ReportKind,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { buildEnrollmentReport } from '@/features/setu/reports/enrollment-report';
import { buildAttendanceReport } from '@/features/setu/reports/attendance-report';
import { schoolYearDateRange } from '@/features/setu/rollover/school-year';
import { attendanceReportToCsv } from '@/features/setu/reports/report-csv';
import { buildRosterCsvRows } from '@/features/setu/roster/build-csv-rows';
import { rosterToCsv } from '@/features/setu/roster/roster-csv';

function csv(body: string, name: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.csv"`,
    },
  });
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const { kind } = await params;
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'unknown-kind' }, { status: 400 });
  }
  const k = kind as ReportKind;

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const claims = { role: session.role, extraRoles: session.extraRoles };
  if (!isWelcomeTeam(claims)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = ReportQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;

  if (k === 'enrollment') {
    if (q.format === 'csv') {
      // Family/member flat CSV = Phase 3's roster export (shared). Conditional
      // spread for the optional filter (exactOptionalPropertyTypes).
      const rows = await buildRosterCsvRows({ ...(q.program ? { program: q.program } : {}) });
      return csv(rosterToCsv(rows), 'enrollment-people');
    }
    return NextResponse.json(await buildEnrollmentReport(q), { status: 200 });
  }

  // attendance (the only remaining kind). Year window wins over the 365-day
  // default, but explicit from/to still win.
  const win = q.year ? schoolYearDateRange(q.year) : undefined;
  const withRange = {
    ...q,
    from: q.from ?? win?.start ?? ymdDaysAgo(365),
    to: q.to ?? win?.end ?? ymdDaysAgo(0),
  };
  const report = await buildAttendanceReport(withRange);
  return q.format === 'csv'
    ? csv(attendanceReportToCsv(report), 'attendance-summary')
    : NextResponse.json(report, { status: 200 });
}
