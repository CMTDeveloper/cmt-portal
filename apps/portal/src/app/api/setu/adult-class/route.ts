import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isSetuManager, PostAdultClassBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { loadAdultClassGateData } from '@/features/setu/adult-class/load-gate-data';
import { isBalaViharPaid } from '@/features/setu/adult-class/needs-selection';
import { selectableAdults } from '@/features/setu/adult-class/selectable-adults';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';

/**
 * The Adult Study Class selection: the family names which non-teaching adult(s)
 * attend. Called by the `/adult-class` screen's Save button.
 *
 * MANAGER-ONLY. The gate that sends families here only fires for managers
 * (condition 1) and this is a family-level commitment, like accepting the
 * disclaimers. `canAccessRoute` grants it too, but this in-handler check is the
 * layer that actually binds - see the three-gate rule in CLAUDE.md.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth || !flags.setuAdultClass) {
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

  // `.strict()`, so a body carrying `fid` is a 400 rather than something we have
  // to remember not to read. The fid below comes from the session, always.
  const raw = await req.json().catch(() => null);
  const parsed = PostAdultClassBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const cached = await getFamilyByFid(session.fid);
  if (!cached) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  // The THROWING loader, not the fail-soft one: on a read failure this must 500
  // and be retried, never silently report "there is nothing to enroll into" and
  // leave the family staring at a screen that refuses to save.
  const data = await loadAdultClassGateData({
    family: cached.family,
    members: cached.members,
    isManager: true,
  });
  // null = no open adult-class offering, or nobody in this household could ever
  // be selected. Both are real conflicts with what the client just submitted.
  if (!data) {
    return NextResponse.json({ error: 'no-adult-class-offering' }, { status: 409 });
  }

  // enroll-family.ts:223-224 takes a supplied `enrolledMids` VERBATIM and skips
  // the member read entirely, so this is the ONLY place a submitted mid is
  // checked at all. Without it a client could enroll a child, a pending invitee,
  // a teacher who is running a class that hour, or a phantom mid - and each one
  // reaches the teacher roster and the CSV exports as a real attendee.
  const selectable = new Set(
    selectableAdults(data.members, data.teacherAssignedMids).map((m) => m.mid),
  );
  // All-or-nothing: a partial enroll would silently drop someone the family
  // believes they signed up.
  //
  // The mids come from THIS family's own members, loaded from the session's fid
  // - never echoed from the body - which is what makes a foreign mid fail here
  // rather than reaching enrollFamily. Keep it that way: enrollFamily skips the
  // member read entirely when mids are supplied, so this set IS the boundary.
  if (!parsed.data.mids.every((mid) => selectable.has(mid))) {
    return NextResponse.json({ error: 'mid-not-selectable' }, { status: 422 });
  }

  // ACCEPTED RACE: `isTeacherAssigned` is a point-in-time read and enrollFamily's
  // transaction has no concept of a teacher, so an adult assigned to teach in the
  // seconds between this check and the commit still lands in `enrolledMids`.
  // Not worth a fix: no money and no access is involved, the worst outcome is a
  // teacher being listed as attending the class they run - which a human notices
  // immediately - and closing it properly would mean teaching the enrollment
  // transaction about teacherAssignments. Consistent with the comparable narrow
  // races Tasks 3 and 4 accepted for the same reason.

  // A family who has paid Bala Vihar attends the Adult Study Class at no further
  // cost (spec 4.5). `0` is a real override and survives because enrollFamily
  // distinguishes it from "not supplied" by `undefined`, never by falsiness.
  // Threshold-free via the shared helper - see isBalaViharPaid.
  const bv = selectBalaViharEnrollment(data.enrollments);
  const bvPaid = bv
    ? isBalaViharPaid({
        bv,
        donations: data.donations,
        legacyPaymentStatus: data.legacyPaymentStatus,
      })
    : false;

  let result: Awaited<ReturnType<typeof enrollFamily>>;
  try {
    result = await enrollFamily({
      fid: session.fid,
      // The SAME oid the gate fired on - resolveCurrentOffering, never `[0]`.
      oid: data.currentOffering!.oid,
      enrolledVia: 'family-initiated',
      enrolledByMid: session.mid,
      enrolledMids: parsed.data.mids,
      suggestedAmountOverride: bvPaid ? 0 : null,
      // Freezes the selection against the member-edit auto-prune, so an unrelated
      // edit cannot silently re-derive "every adult" over the family's choice.
      membershipMode: 'manual',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'family-not-found' || msg === 'offering-not-found') {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    // The admin closed registration between the gate firing and this save. The
    // reconcile above the window gates (enroll-family.ts:119-134) means an
    // already-enrolled family can still CHANGE their choice; only a first
    // enrollment can land here.
    if (msg === 'offering-disabled' || msg === 'offering-expired' || msg === 'program-not-available') {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (msg === 'no-eligible-members') {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    throw err;
  }

  revalidateTag(`family-${session.fid}`, 'max');
  return NextResponse.json(
    { eid: result.eid, enrolledMids: parsed.data.mids, suggestedAmountOverride: bvPaid ? 0 : null },
    { status: result.created ? 201 : 200 },
  );
}
