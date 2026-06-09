import { NextResponse } from 'next/server';
import { isWelcomeTeam, RosterQuerySchema, type RosterQuery } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { listRosterFamilies } from '@/features/setu/roster/list-families';
import { expandPeople } from '@/features/setu/roster/expand-people';
import { rosterToCsv } from '@/features/setu/roster/roster-csv';

export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = RosterQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const params = parsed.data;

  if (params.format === 'csv') {
    // CSV exports the full matched set (no pagination), capped in expandPeople.
    // Build the base query WITHOUT `cursor` (exactOptionalPropertyTypes forbids
    // assigning `cursor: undefined` to the optional field — omit the key, only
    // carrying forward the filters the query supports).
    const filters: RosterQuery = {
      ...(params.location ? { location: params.location } : {}),
      ...(params.program ? { program: params.program } : {}),
      limit: 100,
      format: 'json',
    };
    const all = await listRosterFamilies(filters);
    let families = all.families;
    let cursor = all.nextCursor;
    while (cursor) {
      const next = await listRosterFamilies({ ...filters, cursor });
      families = families.concat(next.families);
      cursor = next.nextCursor;
      if (families.length >= 2000) break; // expandPeople enforces + logs the hard cap
    }
    const csv = rosterToCsv(await expandPeople(families));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="roster.csv"',
      },
    });
  }

  const result = await listRosterFamilies(params);
  return NextResponse.json(result, { status: 200 });
}
