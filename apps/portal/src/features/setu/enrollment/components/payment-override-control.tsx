'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { setEnrollmentOverride } from '../override-client';

export interface PaymentOverrideEnrollment {
  eid: string;
  programLabel: string;
  termLabel: string;
  /** What this family is currently asked for, after any existing override. */
  effectiveSuggestedAmount: number;
  /** null = no override in place; 0 = already marked settled off-portal. */
  suggestedAmountOverride: number | null;
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

  const settled = enrollment.suggestedAmountOverride === 0;
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
              : `Currently asked for $${enrollment.effectiveSuggestedAmount}`}
          </div>
        </div>
        {!open && (
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
