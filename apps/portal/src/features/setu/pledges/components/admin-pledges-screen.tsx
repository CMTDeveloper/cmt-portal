'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { AdminPledgeRow } from '../list-pledges-for-admin';

/**
 * 🔴 The single most important string on this screen.
 *
 * The temple cancels the actual debit MANUALLY in Stripe (Vaibhav 2026-07-26) -
 * there is no cancel endpoint on the payment service and the portal cannot stop
 * a debit. Left implicit, staff would click Cancel, believe the money stopped,
 * and the family would keep being charged. It is asserted in the screen's test
 * for that reason, and it is repeated on the button's confirmation.
 */
export const CANCEL_WARNING =
  'This only updates the record. Cancel the actual debit in Stripe.';

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  active: { bg: 'var(--ok-soft, #d6efe0)', fg: 'var(--ok, #3d7a5a)' },
  started: { bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' },
  failed: { bg: '#f6e3e3', fg: '#8c3d3d' },
  cancelled: { bg: 'var(--line)', fg: 'var(--muted)' },
};

export function AdminPledgesScreen({ rows }: { rows: AdminPledgeRow[] }) {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 500, marginBottom: 6 }}>Monthly pledges</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.6 }}>
        Families giving a fixed monthly amount by pre-authorized debit. The portal records status
        only - it never holds a bank detail.
      </p>

      <div
        role="note"
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', marginBottom: 20,
          background: '#fdefe7', border: '1px solid var(--accentSoft)', borderRadius: 'var(--radiusSm)',
        }}
      >
        <span aria-hidden style={{ color: 'var(--warn)', fontWeight: 700 }}>!</span>
        <span style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5 }}>
          <strong>{CANCEL_WARNING}</strong> The portal cannot stop a debit - cancelling here changes
          what this screen and the family&apos;s dashboard say, nothing more.
        </span>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>No monthly pledges yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '8px 10px' }}>Family</th>
                <th style={{ padding: '8px 10px' }}>Amount</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}>Since</th>
                <th style={{ padding: '8px 10px' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PledgeRow key={r.pid} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PledgeRow({ row }: { row: AdminPledgeRow }) {
  const [status, setStatus] = useState(row.status);
  const [pending, setPending] = useState(false);
  const style = STATUS_STYLE[status] ?? STATUS_STYLE['cancelled']!;
  const cancellable = status === 'started' || status === 'active';

  async function cancel() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/pledges/${encodeURIComponent(row.pid)}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        setStatus('cancelled');
        // Repeated at the moment of the action, not only in the banner above -
        // by the time someone clicks, the banner has scrolled out of mind.
        toast.success(`Record marked cancelled. ${CANCEL_WARNING}`);
        return;
      }
      if (res.status === 409) {
        setStatus('cancelled');
        toast.error('That pledge was already cancelled.');
        return;
      }
      toast.error('Could not cancel - please try again.');
    } catch {
      toast.error('Network error - please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--line)' }}>
      <td style={{ padding: '10px' }}>
        <div style={{ fontWeight: 600 }}>{row.familyName ?? row.fid}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{row.fid}</div>
      </td>
      <td style={{ padding: '10px', fontVariantNumeric: 'tabular-nums' }}>${row.monthlyAmountCAD}/mo</td>
      <td style={{ padding: '10px' }}>
        <span className="pill" style={{ background: style.bg, color: style.fg }}>{status}</span>
        {row.needsStripeVerification && (
          // The portal created a recurring debit against a pledge that had
          // already left `started`. Nothing here can stop it - only a human in
          // Stripe can. `role="status"` so it is in the accessibility tree: a
          // flag recorded in Firestore and never displayed is not findable, and
          // this is the screen where someone would act on it.
          <span
            role="status"
            aria-label="Verify in Stripe"
            title="A subscription was created after this pledge left 'started'. Check Stripe for a live debit."
            style={{
              display: 'inline-block', marginLeft: 6, padding: '2px 8px', borderRadius: 999,
              background: '#fdefe7', color: 'var(--warn)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            Verify in Stripe
          </span>
        )}
      </td>
      <td style={{ padding: '10px', color: 'var(--muted)' }}>{fmt(row.activatedAt ?? row.startedAt)}</td>
      <td style={{ padding: '10px', textAlign: 'right' }}>
        {cancellable && (
          <button
            type="button"
            className="btn btn--s"
            disabled={pending}
            onClick={cancel}
            aria-label={`Cancel the record for ${row.familyName ?? row.fid}`}
          >
            {pending ? 'Cancelling…' : 'Cancel record'}
          </button>
        )}
      </td>
    </tr>
  );
}

function fmt(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-CA', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Toronto',
  });
}
