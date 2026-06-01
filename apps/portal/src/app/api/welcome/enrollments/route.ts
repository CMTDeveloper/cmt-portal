import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isWelcomeTeam, WelcomePostEnrollmentBodySchema } from '@cmt/shared-domain';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';
import { readSessionFromHeaders } from '@/lib/auth/headers';

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isWelcomeTeam(session)) {
    return NextResponse.json({ error: 'welcome-team-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = WelcomePostEnrollmentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { fid, oid } = parsed.data;

  let result: Awaited<ReturnType<typeof enrollFamily>>;
  try {
    result = await enrollFamily({
      fid,
      oid,
      enrolledVia: 'welcome-team',
      enrolledByMid: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'family-not-found') {
      return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    }
    if (msg === 'offering-not-found') {
      return NextResponse.json({ error: 'offering-not-found' }, { status: 404 });
    }
    if (msg === 'offering-disabled') {
      return NextResponse.json({ error: 'offering-disabled' }, { status: 422 });
    }
    if (msg === 'offering-expired') {
      return NextResponse.json({ error: 'offering-expired' }, { status: 422 });
    }
    if (msg === 'program-not-available') {
      return NextResponse.json({ error: 'program-not-available' }, { status: 422 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  const status = result.created ? 201 : 200;
  return NextResponse.json(
    { eid: result.eid, suggestedAmount: result.suggestedAmountSnapshot },
    { status },
  );
}
