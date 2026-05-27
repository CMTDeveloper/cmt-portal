import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isSetuManager, ROLES, type Role, PostEnrollmentBodySchema } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';

export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const fid = req.headers.get('x-portal-fid');
  if (!fid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const enrollments = await getEnrollments(fid);
  return NextResponse.json({ enrollments }, { status: 200 });
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');
  const mid = req.headers.get('x-portal-mid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  const extrasHeader = req.headers.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Role => (ROLES as readonly string[]).includes(s));
  if (!isSetuManager({ role: role as Role, extraRoles })) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = PostEnrollmentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof enrollFamily>>;
  try {
    result = await enrollFamily({
      fid,
      pid: parsed.data.pid,
      enrolledVia: 'family-initiated',
      enrolledByMid: mid ?? null,
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
    if (msg === 'period-not-yet-open') {
      return NextResponse.json({ error: 'period-not-yet-open' }, { status: 422 });
    }
    if (msg === 'period-expired') {
      return NextResponse.json({ error: 'period-expired' }, { status: 422 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  const status = result.created ? 201 : 200;
  return NextResponse.json(
    {
      eid: result.eid,
      suggestedAmount: result.suggestedAmountSnapshot,
      donateUrl: `/family/donate?eid=${result.eid}`,
    },
    { status },
  );
}
