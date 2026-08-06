import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isAdmin, OverrideEnrollmentBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { writeAuditLog } from '@/features/setu/audit/audit-log';
import { adultStudyClassProgramKeys } from '@/features/setu/adult-class/program-keys';
import { deriveFamilyPayment } from '@/features/setu/roster/payment';

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
  // ── Settlement is a SECOND fact, not a re-spelling of the amount ───────────
  //
  // `suggestedAmountOverride: 0` was already taken: it is how the Adult Study
  // Class waiver is stored for a family who paid Bala Vihar. Writing only the 0
  // here left every reader unable to tell "we collect this outside the portal"
  // from "nobody owes anything", and they all chose the second - so a family
  // this route had just marked as paid read "N/A" on the welcome roster and
  // dropped out of the Paid filter. The flag is what the readers key on; the
  // amount is only how the family stops being asked.
  //
  // Cleared, not just unset, when the override goes away: an admin pressing
  // Undo is saying the arrangement is over, and a stale `true` beside a
  // restored $500 ask would be the same ambiguity pointing the other way.
  const settledOffPortal = parsed.data.suggestedAmountOverride === 0;

  // ── A WAIVER IS NOT SETTLEABLE, AND THE SERVER IS WHERE THAT IS DECIDED ─────
  //
  // The Adult Study Class fee is waived for a family who has paid Bala Vihar,
  // stored as a bare `suggestedAmountOverride: 0` with no settlement flag. Two
  // writes against such a row are both wrong and both were accepted here:
  //   - amount 0   -> stamps settledOffPortal, recording money CMT never
  //                   collected, on a row that only ever meant "covered".
  //   - amount null -> clears the waiver and starts billing a family for a class
  //                   their Bala Vihar donation already paid for.
  //
  // The control stopped OFFERING those on 2026-08-04 (FID 5010, Scarborough).
  // That is not a rule: this repo's own lesson is that money rules belong at the
  // server chokepoint and a UI-only restriction is not one. Concretely, an admin
  // whose family page was opened BEFORE that deploy still has the old button in
  // front of them, and the route is a plain authenticated PATCH.
  //
  // Keyed on the PRE-EXISTING bare zero, read fresh inside the transaction - not
  // on the incoming amount. An adult-class family who genuinely owes the fee has
  // `override: null`, so settling them off-portal still works; only a row that
  // is ALREADY a waiver is protected.
  const adultClassKeys = await adultStudyClassProgramKeys();

  // ── AND A FAMILY WHO ALREADY PAID CANNOT BE SETTLED OFF-PORTAL ─────────────
  //
  // Vaibhav, 2026-08-04, FID 5010: "this family has completed the donation, why
  // are we still seeing that button?" Recording an off-portal settlement on top
  // of a real Stripe payment claims CMT collected the money twice, and Undo does
  // not take it back - it writes null and restores the ask.
  //
  // `deriveFamilyPayment` is the same function the family-detail page uses to
  // decide whether to SHOW the button, so the screen an admin read and the rule
  // that stops them are one predicate rather than two kept in step by hand. It
  // ORs in a live monthly pledge, which writes no completed donations - without
  // that, every pledge family would be settleable here while the roster called
  // them Paid.
  //
  // The page and this guard can still DISAGREE across time: the page may have
  // rendered before a donation completed. That asymmetry is the design - the UI
  // is advisory, the server is authoritative, and the 409 carries its own
  // sentence so the admin learns why.
  //
  // Only a POSITIVE 'paid' refuses. 'unknown' (an unpriceable enrollment, a
  // failed read) must stay settleable: this route is the only way to record a
  // real off-portal arrangement, and blocking it on absence of evidence would
  // strand the families it exists for. Refusing SETTLEMENT only - `null` still
  // clears an override, so an admin can always undo their own work.
  const settling = parsed.data.suggestedAmountOverride === 0;
  let alreadyPaid = false;
  if (settling) {
    try {
      alreadyPaid = (await deriveFamilyPayment(enrollmentData.fid)) === 'paid';
    } catch {
      // deriveFamilyPayment already swallows and returns 'unknown'; this is
      // belt-and-braces so a guard can never 500 the action it guards.
      alreadyPaid = false;
    }
  }
  if (alreadyPaid) {
    return NextResponse.json({ error: 'already-paid-in-portal' }, { status: 409 });
  }

  let before: number | null = null;
  let refusedWaiver = false;
  try {
    await db.runTransaction(async (txn) => {
      const fresh = await txn.get(enrollmentRef);
      const data = fresh.data() as
        | { suggestedAmountOverride?: number | null; settledOffPortal?: boolean; programKey?: string }
        | undefined;
      before = data?.suggestedAmountOverride ?? null;

      const isWaiver =
        before === 0
        && data?.settledOffPortal !== true
        && adultClassKeys.includes(data?.programKey ?? '');
      if (isWaiver) {
        // Abort the transaction WITHOUT writing, and without an audit row: no
        // change happened, so a row claiming one would be noise.
        refusedWaiver = true;
        return;
      }

      // ── Provenance, denormalized onto the enrollment ─────────────────────
      // The same who/when/why already goes to `audit_log` below, and that row
      // remains the tamper-evident record. But `audit_log` has no reader
      // anywhere in the codebase and no Firestore index, so "who marked this
      // family paid?" was in practice unanswerable without a composite index
      // and a prod deploy. These three fields put it on a document the welcome
      // desk already reads.
      //
      // CLEARED on un-settle, not just written on settle. An admin who clicks
      // Undo restores the ask, and leaving "Recorded by X on Sep 3" underneath
      // it would attribute a settlement that no longer exists to a named person.
      // `null` rather than FieldValue.delete(): the schema reads the fields as
      // nullable, and an explicit null is a fact ("not settled") where a deleted
      // key is indistinguishable from a document written before the fields
      // existed.
      //
      // `session.email` and not a display name - the session carries no name.
      // See the field's own comment on EnrollmentDocSchema.
      txn.update(enrollmentRef, {
        suggestedAmountOverride: parsed.data.suggestedAmountOverride,
        settledOffPortal,
        settledAt: settledOffPortal ? FieldValue.serverTimestamp() : null,
        settledBy: settledOffPortal ? (session.email ?? null) : null,
        settledNote: settledOffPortal ? parsed.data.note : null,
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
        after: {
          suggestedAmountOverride: parsed.data.suggestedAmountOverride,
          settledOffPortal,
          note: parsed.data.note,
        },
      });
    });
  } catch (err) {
    console.error('[enrollment-override] transaction failed', err);
    return NextResponse.json({ error: 'write-failed' }, { status: 500 });
  }

  // 409, with its OWN reason rather than a generic bad-request: the caller did
  // nothing malformed, the row is simply not settleable. A shared error code
  // here would be indistinguishable from a validation failure in the UI.
  if (refusedWaiver) {
    return NextResponse.json({ error: 'waived-not-settleable' }, { status: 409 });
  }

  revalidateTag(`family-${enrollmentData.fid}`, 'max');
  return NextResponse.json({ ok: true, before }, { status: 200 });
}
