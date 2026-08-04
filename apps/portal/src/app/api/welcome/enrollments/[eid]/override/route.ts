import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isAdmin, OverrideEnrollmentBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { writeAuditLog } from '@/features/setu/audit/audit-log';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eid: string }> },
) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'welcome-team-required' }, { status: 403 });
  }

  const { eid } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = OverrideEnrollmentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = portalFirestore();

  // eid = "{fid}-{pid}" — look up by collectionGroup to avoid needing fid upfront.
  const enrollmentSnaps = await db
    .collectionGroup('enrollments')
    .where('eid', '==', eid)
    .limit(1)
    .get();

  if (enrollmentSnaps.empty) {
    return NextResponse.json({ error: 'enrollment-not-found' }, { status: 404 });
  }

  const enrollmentRef = enrollmentSnaps.docs[0]!.ref;
  const enrollmentData = enrollmentSnaps.docs[0]!.data() as { status: string; fid: string };

  if (enrollmentData.status !== 'active') {
    return NextResponse.json({ error: 'enrollment-not-active' }, { status: 409 });
  }

  // An admin session always carries a uid; refusing without one is not defence
  // against a real caller but against writing an audit row that names nobody.
  // The row is the entire justification for allowing this action at all - the
  // same reasoning as the pledge-cancel route.
  if (!session.uid) {
    return NextResponse.json({ error: 'no-actor' }, { status: 401 });
  }

  // ── Write and record TOGETHER, or not at all ───────────────────────────────
  //
  // In a transaction so the audit row cannot be missing for a change that
  // happened, nor present for one that did not. This route moves MONEY - it
  // decides whether a family is asked for $500 - so "who did this, when, and
  // why" has to be a structural guarantee rather than a habit. `writeAuditLog`
  // takes the caller's transaction for exactly this reason.
  //
  // The `before` value is re-read INSIDE the transaction rather than reused
  // from the query above: between the collectionGroup read and the commit,
  // another admin could have set a different amount, and an audit row claiming
  // the wrong previous value is worse than none - it would send whoever reads
  // it looking for a change that never happened.
  let before: number | null = null;
  try {
    await db.runTransaction(async (txn) => {
      const fresh = await txn.get(enrollmentRef);
      const data = fresh.data() as { suggestedAmountOverride?: number | null } | undefined;
      before = data?.suggestedAmountOverride ?? null;

      txn.update(enrollmentRef, {
        suggestedAmountOverride: parsed.data.suggestedAmountOverride,
        updatedAt: FieldValue.serverTimestamp(),
      });

      writeAuditLog(txn, db, {
        actorUid: session.uid!,
        actorMid: session.mid ?? null,
        actorRole: session.role,
        // Load-bearing: an admin who is also a parent has `family-manager` as
        // their primary role, so a row naming only that reads as a family
        // manager rewriting another family's money.
        actorExtraRoles: session.extraRoles ?? [],
        action: 'enrollment.payment-override',
        fid: enrollmentData.fid,
        mid: null,
        before: { suggestedAmountOverride: before },
        after: { suggestedAmountOverride: parsed.data.suggestedAmountOverride, note: parsed.data.note },
      });
    });
  } catch (err) {
    console.error('[enrollment-override] transaction failed', err);
    return NextResponse.json({ error: 'write-failed' }, { status: 500 });
  }

  revalidateTag(`family-${enrollmentData.fid}`, 'max');
  return NextResponse.json({ ok: true, before }, { status: 200 });
}
