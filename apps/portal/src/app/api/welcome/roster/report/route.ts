import { NextResponse } from 'next/server';
import { isWelcomeTeam, matchesRosterFilters, type RosterReportFilters, ROSTER_PAYMENTS } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { buildRosterReportDataset } from '@/features/setu/roster/report-dataset';
import { rosterToCsv } from '@/features/setu/roster/roster-csv';

const YEAR_RE = /^\d{4}-\d{2}$/;

function paymentParam(v: string | null): RosterReportFilters['payment'] {
  return v && (ROSTER_PAYMENTS as readonly string[]).includes(v) ? (v as RosterReportFilters['payment']) : null;
}

export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const yearRaw = searchParams.get('year');
  const year = yearRaw && YEAR_RE.test(yearRaw) ? yearRaw : undefined;

  const dataset = await buildRosterReportDataset(year ? { year } : {});

  if (searchParams.get('format') === 'csv') {
    // exactOptionalPropertyTypes: only set filter keys that are present.
    const pay = paymentParam(searchParams.get('payment'));
    const filters: RosterReportFilters = {
      ...(searchParams.get('location') ? { location: searchParams.get('location') } : {}),
      ...(searchParams.get('program') ? { program: searchParams.get('program') } : {}),
      ...(searchParams.get('level') ? { level: searchParams.get('level') } : {}),
      ...(searchParams.get('grade') ? { grade: searchParams.get('grade') } : {}),
      ...(pay ? { payment: pay } : {}),
    };
    const personRows = dataset.filter((f) => matchesRosterFilters(f.row, filters)).flatMap((f) => f.personRows);
    const csv = rosterToCsv(personRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="roster.csv"',
      },
    });
  }

  return NextResponse.json({ rows: dataset.map((f) => f.row) }, { status: 200 });
}
