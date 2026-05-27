import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { WelcomePostEnrollmentBodySchema } from '@cmt/shared-domain';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'welcome-team' && role !== 'admin') {
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

  const { fid, pid } = parsed.data;

  let result: Awaited<ReturnType<typeof enrollFamily>>;
  try {
    result = await enrollFamily({
      fid,
      pid,
      enrolledVia: 'welcome-team',
      enrolledByMid: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'family-not-found') {
      return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    }
    if (msg === 'period-not-found') {
      return NextResponse.json({ error: 'period-not-found' }, { status: 404 });
    }
    if (msg === 'period-disabled') {
      return NextResponse.json({ error: 'period-disabled' }, { status: 422 });
    }
    if (msg === 'period-expired') {
      return NextResponse.json({ error: 'period-expired' }, { status: 422 });
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
