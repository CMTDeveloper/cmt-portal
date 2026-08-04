'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { enrollFamilyAsAdmin, setEnrollmentOverride } from '../override-client';

export interface AdminEnrollOffering {
  oid: string;
  programLabel: string;
  termLabel: string;
  /** The standard ask for this offering, shown so the admin knows what they are waiving. */
  suggestedAmount: number;
}

/**
 * Eligibility is DELIBERATELY not computed here.
 *
 * `enrollFamily` derives the eligible members from the program's own rules, and
 * the family's enroll page derives the same set. A third derivation on this
 * page could disagree with both - and would disagree silently, by disabling a
 * button for a family the server would happily have enrolled. So the control
 * attempts the enrollment and reports the server's `no-eligible-members`
 * answer, which cannot drift from the rule it is reporting.
 */

/**
 * Enrol a family, and optionally settle their donation, FROM THE OFFICE.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * Vaibhav, 2026-08-03: *"if family comes to admin and says they already pay
 * monthly through other medium... admin should be able to enroll their kids and
 * pay for them in the system"*.
 *
 * Before this the override could only act on an enrollment that already
 * existed, so a family who pays outside the portal had to enrol themselves
 * first - and the family's own enroll page has no enrol-WITHOUT-paying path:
 * "Enroll and continue →" enrols and immediately redirects to Stripe. They end
 * up enrolled either way (DonationChoice enrols first and pays second), but
 * only by starting a bank mandate and abandoning it. That is a rotten thing to
 * ask of a donor of ten years who already gives every month.
 *
 * ── Two buttons, because they are two different truths ──────────────────────
 * "Enrol and mark paid" is the requested flow. "Enrol only" exists because an
 * admin also helps families who WILL pay in the portal, and silently marking
 * those settled would stop them ever being asked. Collapsing both into one
 * button would force a wrong answer on one of the two.
 *
 * ── Why enrol-then-override rather than one endpoint ────────────────────────
 * Two calls, deliberately: `POST /api/welcome/enrollments` mints the enrollment
 * and its eid, and the override needs that eid. If the second call fails the
 * family is still correctly ENROLLED and the admin is told exactly what is left
 * to do - which is a better failure than a combined endpoint that has to decide
 * whether to roll back a legitimate enrollment because a bookkeeping flag did
 * not stick.
 */
export function AdminEnrollControl({
  fid,
  offering,
  onDone,
}: {
  fid: string;
  offering: AdminEnrollOffering;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'paid' | 'only'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const noteOk = note.trim().length >= 3;

  function finish() {
    setBusy(false);
    setMode('idle');
    setNote('');
    // HARD reload, not router.refresh(): this page reads family data through
    // `use cache` and both routes just called revalidateTag, so a soft refresh
    // can re-render the state we changed away from.
    if (onDone) onDone();
    else window.location.reload();
  }

  async function run(markPaid: boolean) {
    if (busy) return;
    if (markPaid && !noteOk) {
      toast.error('Add a short note saying why - it is kept with the record.');
      return;
    }
    setBusy(true);

    const enrolled = await enrollFamilyAsAdmin(fid, offering.oid);
    if (!enrolled.ok) {
      toast.error(
        enrolled.reason === 'no-eligible-members'
          ? 'Nobody in this family is eligible for this program yet - check the children’s grades.'
          : enrolled.reason === 'offering-unavailable'
            ? 'That offering is closed or disabled, so nobody can be enrolled into it.'
            : enrolled.reason === 'forbidden'
              ? 'Only an admin can enrol a family from here.'
              : 'Could not enrol this family. Please try again.',
      );
      setBusy(false);
      return;
    }

    if (!markPaid) {
      toast.success('Enrolled. The family will be asked for the standard donation.');
      finish();
      return;
    }

    const marked = await setEnrollmentOverride(enrolled.eid, 0, note.trim());
    if (marked.ok) {
      toast.success('Enrolled and marked as settled off-portal.');
      finish();
      return;
    }
    // The enrollment DID land. Say so plainly rather than reporting a blanket
    // failure that would send the admin to enrol them a second time.
    toast.error(
      'Enrolled, but could not mark it paid. Use "Mark paid off-portal" on the enrollment below.',
    );
    finish();
  }

  return (
    <div className="card" data-testid="admin-enroll-control" style={{ padding: 16, marginTop: 12 }}>
      <div className="between" style={{ gap: 10, flexWrap: 'wrap', marginBottom: mode === 'idle' ? 0 : 10 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>
            {offering.programLabel} · {offering.termLabel}
          </strong>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Not enrolled · standard donation ${offering.suggestedAmount}
          </div>
        </div>
        {mode === 'idle' && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--p" style={{ fontSize: 13, whiteSpace: 'nowrap' }} onClick={() => setMode('paid')}>
              Enrol and mark paid
            </button>
            <button type="button" className="btn btn--g" style={{ fontSize: 13, whiteSpace: 'nowrap' }} onClick={() => setMode('only')}>
              Enrol only
            </button>
          </div>
        )}
      </div>

      {mode === 'only' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, margin: 0 }}>
            Enrol this family&apos;s eligible members. They will still be asked for the standard
            ${offering.suggestedAmount} donation in the portal.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--p" style={{ fontSize: 13 }} disabled={busy} onClick={() => run(false)}>
              {busy ? 'Enrolling…' : 'Confirm - enrol only'}
            </button>
            <button type="button" className="btn btn--g" style={{ fontSize: 13 }} disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'paid' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, margin: 0 }}>
            Enrol this family&apos;s eligible members and record the ${offering.suggestedAmount}{' '}
            donation as already settled outside the portal. They will not be asked to donate.
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
                width: '100%', boxSizing: 'border-box', padding: '9px 11px',
                borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)',
                fontFamily: 'var(--body)', fontSize: 14, background: 'var(--bg)', color: 'var(--ink)',
              }}
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--p" style={{ fontSize: 13 }} disabled={busy || !noteOk} onClick={() => run(true)}>
              {busy ? 'Working…' : 'Confirm - enrol and mark paid'}
            </button>
            <button type="button" className="btn btn--g" style={{ fontSize: 13 }} disabled={busy} onClick={() => { setMode('idle'); setNote(''); }}>
              Cancel
            </button>
          </div>
          {!noteOk && <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>A reason is required.</p>}
        </div>
      )}
    </div>
  );
}
