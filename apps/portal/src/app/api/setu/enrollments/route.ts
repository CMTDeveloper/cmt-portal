import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { ADULT_STUDY_CLASS, isSetuFamily, isSetuManager, PostEnrollmentBodySchema } from '@cmt/shared-domain';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getOfferingProgramKey } from '@/features/setu/enrollment/get-offering';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { resolveTeacherAssignedMids } from '@/features/setu/adult-class/load-gate-data';
import {
  resolveAdultClassEnrollParams,
  type AdultClassEnrollParams,
} from '@/features/setu/adult-class/enroll-params';

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

  // ── The Adult Study Class is a SECOND DOOR into the same program ──────────
  // This route and the bespoke /api/setu/adult-class both call enrollFamily. If
  // this one keeps calling it bare, a Bala Vihar family enrolling through
  // /family/enroll/adult-study-class is billed $101, has EVERY adult
  // auto-enrolled (teachers and pending invitees included), gets
  // membershipMode 'auto' so the next member edit re-adds them all, and - because
  // enrolledMids ends up non-empty - satisfies the gate's condition 4, so they
  // never see the selection screen at all. One doc read tells us which door this
  // is; every other programKey below behaves EXACTLY as it always has.
  const programKey = await getOfferingProgramKey(parsed.data.oid);
  let adultClass: AdultClassEnrollParams | null = null;
  if (programKey === ADULT_STUDY_CLASS) {
    const [cached, enrollments] = await Promise.all([
      getFamilyByFid(session.fid),
      getEnrollments(session.fid),
    ]);
    if (!cached) {
      return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    }
    // The SAME teacher set the gate and the bespoke route use - two hand-rolled
    // definitions of "who teaches" would let the two doors enroll different people.
    const teacherAssignedMids = await resolveTeacherAssignedMids(cached.members);
    adultClass = resolveAdultClassEnrollParams(
      { members: cached.members, enrollments, teacherAssignedMids },
      parsed.data.oid,
    );
    // Nobody selectable: every adult teaches, or the household has none. Writing
    // an empty enrolledMids would be refused by enrollFamily anyway
    // ('no-eligible-members'); saying so directly is clearer than a 400 that
    // blames the family for having no eligible members when the real reason is
    // that all of theirs are teaching.
    if (adultClass.enrolledMids.length === 0) {
      return NextResponse.json({ error: 'no-selectable-adults' }, { status: 422 });
    }
  }

  let result: Awaited<ReturnType<typeof enrollFamily>>;
  try {
    result = await enrollFamily({
      fid: session.fid,
      oid: parsed.data.oid,
      enrolledVia: 'family-initiated',
      enrolledByMid: session.mid,
      // Spread, never explicit `undefined`: exactOptionalPropertyTypes is on, and
      // enrollFamily distinguishes "not supplied" from a supplied `null` by
      // presence. A `waiver` of null means leave the stored override alone.
      ...(adultClass
        ? {
            enrolledMids: adultClass.enrolledMids,
            membershipMode: adultClass.membershipMode,
            ...(adultClass.waiver ?? {}),
          }
        : {}),
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
    if (msg === 'no-eligible-members') {
      return NextResponse.json({ error: 'no-eligible-members' }, { status: 400 });
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
