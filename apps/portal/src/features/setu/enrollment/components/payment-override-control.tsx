'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { setEnrollmentOverride } from '../override-client';

export interface PaymentOverrideEnrollment {
  eid: string;
  /** So the page can say WHY Bala Vihar is absent instead of just omitting it. */
  programKey: string;
  programLabel: string;
  termLabel: string;
  /** What this family is currently asked for, after any existing override. */
  effectiveSuggestedAmount: number;
  /**
   * The raw amount override. `null` = none in place.
   *
   * A `0` here is NOT enough to conclude anything: it is written both by an
   * admin settling a family off-portal AND by the Adult Study Class waiver for
   * a family who has paid Bala Vihar. Read `settledOffPortal` for the first.
   */
  suggestedAmountOverride: number | null;
  /**
   * An admin recorded that CMT collects this family's donation outside the
   * portal. REQUIRED, so the page that builds this object cannot forget it -
   * that object is hand-mapped from `getEnrollments`, and a hand-mapped
   * projection silently dropping a new field is precisely how this control kept
   * the old meaning of `0` after the rest of the app had moved on.
   */
  settledOffPortal: boolean;
  /**
   * Is this enrollment's program an Adult Study Class? REQUIRED, and resolved on
   * the SERVER - it cannot be derived here.
   *
   * ── Why this is a prop and not `programKey === ADULT_STUDY_CLASS` ───────────
   * It was that literal, from 2026-08-04 until Vaibhav reported FID 5010 the
   * same evening: a Scarborough family's genuinely-waived adult class rendered
   * as "Not being asked to donate - no reason recorded" WITH a "Mark paid
   * off-portal" button. Clicking it would have recorded a payment that never
   * happened.
   *
   * "Which programs are the adult class" is DATA, not a key. Each centre may run
   * its own (CMT decision 2026-07-29); Scarborough's is `adult-study-east`, and
   * `isAdultStudyClassProgram()` reads `capabilities.isAdultStudyClass`, falling
   * back to the literal key only when that flag is ABSENT. The literal can
   * therefore never identify anything but Brampton's.
   *
   * features/setu/adult-class/program-keys.ts exists for exactly this reason and
   * already documented the trap - "none of them could ever fire for a
   * Scarborough family" - which is why this is a required prop rather than a
   * comment asking the next caller to remember.
   */
  isAdultClass: boolean;
  /**
   * Has this family's donation ALREADY arrived through the portal? REQUIRED,
   * and family-level rather than per-enrollment because donations are recorded
   * against the family, not the row.
   *
   * ── Why ─────────────────────────────────────────────────────────────────────
   * Vaibhav, 2026-08-04, on FID 5010: "this family has completed the donation,
   * why are we still seeing that button?" The row read "Currently asked for
   * $400" beside "Mark paid off-portal" for a family the ROSTER already labels
   * Paid - two screens in one app disagreeing about whether money arrived.
   *
   * The control could not have known: its inputs were the suggested amount, the
   * override, the settled flag and the program key. `effectiveSuggestedAmount`
   * is the term's ASK, not a balance owing, so it says $400 whether the family
   * paid last week or never.
   *
   * That is worse than confusing on a money screen. An admin reasonably reads
   * "asked for $400" as "owes $400", settles them off-portal, and now a real
   * Stripe payment and a fabricated off-portal settlement both exist against one
   * enrollment - and Undo does not restore the previous state, it writes null
   * and restores the ask. Recovery takes the audit row and an engineer.
   *
   * The verdict comes from `deriveFamilyPayment`, which the route's guard also
   * calls - one predicate, so the screen and the rule behind it move together.
   * Only a positive 'paid' suppresses the action: 'unknown' leaves it available,
   * because removing a legitimate tool on a failed read is its own harm.
   *
   * Note what that does NOT promise. The route re-runs the SAME predicate, so it
   * refuses only when ITS read also returns 'paid'; if that read fails, both
   * allow. This is a de-duplication guard, not authorization - admin-only, a
   * required note, and a transactional audit row are what actually protect the
   * action. And 'paid' ultimately rests on donation `status: 'completed'`, which
   * is client-reported (there is no Stripe webhook), so it means "our records
   * say the money arrived", not "the bank confirmed it".
   */
  familyHasPaid: boolean;
}

/**
 * Mark an enrollment settled outside the portal - ADMIN ONLY.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * Long-standing donors whose pre-authorized debit is already collected by CMT
 * outside Stripe. Sadeesh Poovalur, 2026-08-03: *"In my case the pledge is
 * preauthorized and my details are already with Chinmaya mission and gets
 * deducted automatically."* Left alone, the portal keeps asking those families
 * for a donation they are already making, and a second bank mandate is exactly
 * the outcome to avoid.
 *
 * Vaibhav confirmed the process on the same day: *"for such families, we have
 * mark the enrollment manually"*, admin-only, *"we can also add some notes and
 * record it"*.
 *
 * ── Why the note is required, and typed rather than picked ──────────────────
 * A dropdown of canned reasons would be faster and would tell whoever reads the
 * audit row a year from now almost nothing. The useful content is which
 * arrangement this family actually has - and that is not enumerable in advance.
 * The server enforces the same minimum; a UI-only rule is not a rule.
 *
 * ── Why the confirm step ────────────────────────────────────────────────────
 * This decides whether a family is asked for money. It is one click away from a
 * read-only page a coordinator also uses, and the cost of a misclick is a
 * household that is never billed and nobody noticing until the year is over.
 * Undoing it is possible (Clear), but only if someone realises.
 */
export function PaymentOverrideControl({
  enrollment,
  onDone,
}: {
  enrollment: PaymentOverrideEnrollment;
  /** Called after a successful write so the page can re-read. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // ── The three states, and why `0` alone decides none of them ───────────────
  //
  // Keyed on the FLAG, not on the amount. Until 2026-08-04 this read
  // `suggestedAmountOverride === 0`, which is also how the Adult Study Class
  // fee is waived for a family who has paid Bala Vihar. So a family with both
  // enrollments showed their WAIVED adult class as "Marked settled outside the
  // portal" with an Undo button - and Undo clears the override, which would
  // have started asking that family to pay for a class their Bala Vihar
  // donation already covers. Found by Codex review, not by a test: the
  // component's own SETTLED fixture was `{ suggestedAmountOverride: 0 }` and
  // encoded the same mistake.
  const settled = enrollment.settledOffPortal;
  const zeroed = !settled && enrollment.suggestedAmountOverride === 0;
  // A zero the admin did not put there. Nothing to undo - the waiver follows
  // from the Bala Vihar payment, so the way to change it is to change that.
  //
  // Scoped to the ADULT STUDY CLASS, because that is the only place the waiver
  // is ever written. TWO routes emit `suggestedAmountOverride: 0` without a
  // settlement - `api/setu/adult-class/route.ts` and the generic
  // `api/setu/enrollments/route.ts` (via `resolveAdultClassEnrollParams`,
  // enroll-params.ts:90) - and BOTH are gated on `isAdultStudyClassKey`, so the
  // invariant holds: a bare unexplained zero never sits on an adult-class
  // enrollment. Check that gate before adding a third writer; an ungated one
  // would land here as "no reason recorded" with a money button beside it.
  // Without the scope this branch
  // swallowed every bare zero - including the Bala Vihar enrollment of the ONE
  // production family settled before the flag existed, which would have shown
  // them "covered by this family's Bala Vihar donation" ON their Bala Vihar
  // enrollment and, far worse, offered no button at all to re-record it.
  //
  // `isAdultClass` is resolved on the server. It was `programKey ===
  // ADULT_STUDY_CLASS` for one day, which silently excluded every centre whose
  // adult class is its own program - see the prop's note.
  const waived = zeroed && enrollment.isAdultClass;
  // A zero with no recorded reason: a settlement made before `settledOffPortal`
  // existed, or a staff amount nobody explained. It still needs the action -
  // that is how it acquires a reason - but never "Undo", which on an
  // unattributed zero could just as easily be clearing something load-bearing.
  const unexplainedZero = zeroed && !waived;
  // The money already arrived through Stripe. Ranked BELOW settled and waived on
  // purpose: those are statements about this enrollment, while this is a
  // family-level fact, and a row an admin deliberately settled should keep
  // saying so (and keep its Undo) even if a portal donation also exists - that
  // combination is worth showing, not hiding.
  const alreadyPaid = !settled && !waived && !zeroed && enrollment.familyHasPaid;
  // Trimmed, because the server trims too - a form that enables Save on "   "
  // and then shows a 400 has taught the user nothing.
  const noteOk = note.trim().length >= 3;

  async function submit(amount: number | null) {
    if (busy) return;
    if (!noteOk) {
      toast.error('Add a short note saying why - it is kept with the record.');
      return;
    }
    setBusy(true);
    const result = await setEnrollmentOverride(enrollment.eid, amount, note.trim());
    if (result.ok) {
      toast.success(
        amount === 0
          ? 'Marked as settled off-portal. The family will not be asked to donate.'
          : 'Override cleared. The family will be asked for the standard amount again.',
      );
      setOpen(false);
      setNote('');
      setBusy(false);
      // A HARD reload, not router.refresh(): this page reads family data through
      // `use cache`, and the route just called revalidateTag. A soft refresh can
      // re-render from the value that was true before the write and show the
      // admin the state they just changed away from.
      if (onDone) onDone();
      else window.location.reload();
      return;
    }
    toast.error(
      result.reason === 'forbidden'
        ? 'Only an admin can change what a family is asked to give.'
        : result.reason === 'waived'
          // Not an error the admin caused. The waiver follows from the Bala
          // Vihar payment, so that is where a change would have to happen.
          ? 'This class is covered by the family’s Bala Vihar donation - there is nothing to record here.'
        : result.reason === 'already-paid'
          ? 'This family has already donated through the portal - recording an off-portal payment would double-count it.'
        : result.reason === 'not-active'
          ? 'That enrollment is no longer active.'
          : result.reason === 'bad-request'
            ? 'The note is too short - a few words is enough.'
            : 'Could not save. Please try again.',
    );
    setBusy(false);
  }

  return (
    <div
      className="card"
      data-testid="payment-override-control"
      style={{ padding: 16, marginTop: 12, borderColor: settled ? 'var(--ok)' : 'var(--line)' }}
    >
      <div className="between" style={{ gap: 10, flexWrap: 'wrap', marginBottom: settled || open ? 10 : 0 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>
            {enrollment.programLabel} · {enrollment.termLabel}
          </strong>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {settled
              ? 'Marked settled outside the portal - not being asked to donate'
              : waived
                ? 'Included - covered by this family’s Bala Vihar donation'
                : alreadyPaid
                  // States the FACT rather than the ask. "Currently asked for
                  // $400" is what made an admin reach for the button.
                  ? 'Paid through the portal - nothing outstanding'
                  : unexplainedZero
                    ? 'Not being asked to donate - no reason recorded'
                    : `Currently asked for $${enrollment.effectiveSuggestedAmount}`}
          </div>
        </div>
        {/* No button on a WAIVED enrollment. The zero was not an admin decision,
            so there is nothing here to undo - and "Undo" would have cleared the
            waiver and started billing a family for a class they had already
            paid for. If the waiver is wrong, the Bala Vihar payment behind it is
            what changed. */}
        {/* Nor on a family whose donation already arrived through Stripe. The
            button's whole purpose is to record money collected ELSEWHERE; here
            it would add a fabricated off-portal settlement on top of a real
            payment, and Undo would not take it back. */}
        {!open && !waived && !alreadyPaid && (
          <button
            type="button"
            className={settled ? 'btn btn--g' : 'btn btn--p'}
            style={{ fontSize: 13, whiteSpace: 'nowrap' }}
            onClick={() => setOpen(true)}
          >
            {settled ? 'Undo' : 'Mark paid off-portal'}
          </button>
        )}
      </div>

      {open && (
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, margin: 0 }}>
            {settled
              ? 'This family will be asked for the standard amount again.'
              : 'This family will no longer be asked to donate for this enrollment. Use it when the donation is already being collected outside the portal.'}
          </p>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Reason (kept with the record)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Existing pre-authorized debit with CMT - confirmed with Ushaji"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 11px',
                borderRadius: 'var(--radiusSm)',
                border: '1px solid var(--line2)',
                fontFamily: 'var(--body)',
                fontSize: 14,
                background: 'var(--bg)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--p"
              style={{ fontSize: 13 }}
              disabled={busy || !noteOk}
              onClick={() => submit(settled ? null : 0)}
            >
              {busy ? 'Saving…' : settled ? 'Confirm undo' : 'Confirm - mark paid'}
            </button>
            <button
              type="button"
              className="btn btn--g"
              style={{ fontSize: 13 }}
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setNote('');
              }}
            >
              Cancel
            </button>
          </div>
          {!noteOk && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              A reason is required.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
