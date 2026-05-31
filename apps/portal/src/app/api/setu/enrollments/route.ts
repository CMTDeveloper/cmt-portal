import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isSetuFamily, isSetuManager, PostEnrollmentBodySchema } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';
import { readSessionFromHeaders } from '@/lib/auth/headers';

export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isSetuFamily(session)) {
    return NextResponse.json({ error: 'family-required' }, { status: 403 });
  }
  if (!session.fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const enrollments = await getEnrollments(session.fid);
  return NextResponse.json({ enrollments }, { status: 200 });
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isSetuManager(session)) {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!session.fid) {
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
      fid: session.fid,
      oid: parsed.data.oid,
      enrolledVia: 'family-initiated',
      enrolledByMid: session.mid,
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

  revalidateTag(`family-${session.fid}`, 'max');
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
