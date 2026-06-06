'use client';

import { useState } from 'react';
import { SetuIcon, toast } from '@cmt/ui';
import { confirmSignup, fetchRoster, type RosterData, type RosterRow } from './roster-client';

interface RosterManagerProps {
  initial: RosterData;
}

// ─── shared styles ─────────────────────────────────────────────────────────────

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.07em',
};

const fieldStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 7,
  padding: '11px 13px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--surface)',
  fontSize: 15,
  color: 'var(--ink)',
  fontFamily: 'var(--body)',
  boxSizing: 'border-box',
  minHeight: 46,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
}

/** A thin middot separator between inline metadata items. */
function Dot() {
  return (
    <span aria-hidden style={{ color: 'var(--line2)' }}>
      ·
    </span>
  );
}

function capacityLabel(capacity: number | null): string {
  return capacity == null ? 'Unlimited spots' : `${capacity} spot${capacity === 1 ? '' : 's'}`;
}

// ─── main component ────────────────────────────────────────────────────────────

export function RosterManager({ initial }: RosterManagerProps) {
  const { opportunity } = initial;
  const [rows, setRows] = useState<RosterRow[]>(initial.rows);

  // One row's hours editor open at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoursDraft, setHoursDraft] = useState<string>('');
  // Guards double-submits: the signupId currently mutating.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const signedUpCount = rows.filter((r) => r.status === 'signed-up').length;
  const completedCount = rows.filter((r) => r.status === 'completed').length;
  const noShowCount = rows.filter((r) => r.status === 'no-show').length;

  function openHoursEditor(row: RosterRow) {
    setEditingId(row.signupId);
    setHoursDraft(row.status === 'completed' ? String(row.hoursAwarded) : String(opportunity.defaultHours));
  }

  async function afterConfirm() {
    const fresh = await fetchRoster(opportunity.oppId);
    if (fresh) setRows(fresh.rows);
    setEditingId(null);
    toast.success('Saved');
  }

  function handleError(error?: string) {
    if (error === 'not-confirmable') {
      toast.error('This sign-up was cancelled by the family');
    } else {
      toast.error('Could not save — please try again');
    }
  }

  async function submitCompleted(row: RosterRow) {
    if (pendingId) return;
    const hours = Number(hoursDraft);
    if (!Number.isFinite(hours) || hours < 0) {
      toast.error('Hours must be 0 or more');
      return;
    }
    setPendingId(row.signupId);
    const res = await confirmSignup(row.signupId, { status: 'completed', hoursAwarded: hours });
    setPendingId(null);
    if (!res.ok) {
      handleError(res.error);
      return;
    }
    await afterConfirm();
  }

  async function submitNoShow(row: RosterRow) {
    if (pendingId) return;
    setPendingId(row.signupId);
    // Build the body WITHOUT an hoursAwarded key (exactOptionalPropertyTypes).
    const res = await confirmSignup(row.signupId, { status: 'no-show' });
    setPendingId(null);
    if (!res.ok) {
      handleError(res.error);
      return;
    }
    await afterConfirm();
  }

  // Render-helper (called as a function, never a nested component — a nested
  // component remounts on every render and steals input focus).
  function renderHoursEditor(row: RosterRow) {
    const pending = pendingId === row.signupId;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={labelStyle} htmlFor={`hours-${row.signupId}`}>
          Hours awarded
          <input
            id={`hours-${row.signupId}`}
            aria-label="Hours awarded"
            type="number"
            min={0}
            step={0.5}
            value={hoursDraft}
            onChange={(ev) => setHoursDraft(ev.target.value)}
            style={fieldStyle}
          />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--p"
            onClick={() => submitCompleted(row)}
            disabled={pending}
            style={{ flex: '1 1 140px', minHeight: 46, padding: '13px 24px' }}
          >
            {pending ? 'Saving…' : 'Confirm'}
          </button>
          <button
            type="button"
            className="btn btn--s"
            onClick={() => setEditingId(null)}
            disabled={pending}
            style={{ flex: '1 1 100px', minHeight: 46 }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function renderRowAction(row: RosterRow) {
    if (editingId === row.signupId) {
      return renderHoursEditor(row);
    }

    const pending = pendingId === row.signupId;

    if (row.status === 'signed-up') {
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--p"
            onClick={() => openHoursEditor(row)}
            disabled={pendingId !== null}
            style={{ flex: '1 1 150px', minHeight: 46 }}
          >
            <SetuIcon.check width={15} height={15} /> Mark completed
          </button>
          <button
            type="button"
            className="btn btn--g"
            onClick={() => submitNoShow(row)}
            disabled={pendingId !== null}
            style={{ flex: '1 1 120px', minHeight: 46 }}
          >
            {pending ? 'Saving…' : 'No-show'}
          </button>
        </div>
      );
    }

    if (row.status === 'completed') {
      return (
        <button
          type="button"
          className="btn btn--s"
          onClick={() => openHoursEditor(row)}
          disabled={pendingId !== null}
          style={{ minHeight: 44 }}
        >
          <SetuIcon.edit width={14} height={14} /> Edit hours
        </button>
      );
    }

    // no-show — offer a correction path back to completed.
    return (
      <button
        type="button"
        className="btn btn--s"
        onClick={() => openHoursEditor(row)}
        disabled={pendingId !== null}
        style={{ minHeight: 44 }}
      >
        <SetuIcon.check width={14} height={14} /> Mark completed
      </button>
    );
  }

  function renderStatusPill(row: RosterRow) {
    if (row.status === 'completed') {
      return (
        <span
          className="pill"
          style={{
            flex: '0 0 auto',
            fontWeight: 600,
            background: 'var(--accentSoft)',
            color: 'var(--accentDeep)',
          }}
        >
          <SetuIcon.check width={13} height={13} /> Completed · {row.hoursAwarded} hrs
        </span>
      );
    }
    if (row.status === 'no-show') {
      return (
        <span
          className="pill"
          style={{ flex: '0 0 auto', fontWeight: 600, background: 'var(--surface2)', color: 'var(--muted)' }}
        >
          No-show
        </span>
      );
    }
    return (
      <span
        className="pill"
        style={{ flex: '0 0 auto', fontWeight: 600, background: 'var(--surface2)', color: 'var(--body-text)' }}
      >
        To confirm
      </span>
    );
  }

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 24 }}>
        <p style={eyebrowStyle}>Seva roster</p>
        <h1 style={{ fontSize: 'clamp(26px, 6.5vw, 36px)', fontWeight: 400, marginTop: 8, lineHeight: 1.1 }}>
          {opportunity.title}
        </h1>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            fontSize: 13.5,
            color: 'var(--body-text)',
          }}
        >
          <span>{fmtDate(opportunity.date)}</span>
          <Dot />
          <span>{opportunity.defaultHours} hrs</span>
          {opportunity.location && (
            <>
              <Dot />
              <span>{opportunity.location}</span>
            </>
          )}
          <Dot />
          <span>{capacityLabel(opportunity.capacity)}</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
          {signedUpCount} to confirm · {completedCount} completed · {noShowCount} no-show
        </p>
      </header>

      {/* Roster */}
      {rows.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 'clamp(28px, 7vw, 44px) 24px',
            textAlign: 'center',
            background: 'var(--surface)',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              background: 'var(--accentSoft)',
              color: 'var(--accentDeep)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <SetuIcon.heart />
          </div>
          <p style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 600 }}>No sign-ups yet</p>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8, maxWidth: 320, marginInline: 'auto', lineHeight: 1.5 }}>
            When families sign up for this opportunity, they&apos;ll appear here for you to confirm.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.map((row) => (
            <div key={row.signupId} className="card" style={{ padding: 'clamp(16px, 4vw, 22px)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25 }}>
                    {row.familyName}
                  </div>
                  {row.memberName && (
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>For {row.memberName}</div>
                  )}
                </div>
                {renderStatusPill(row)}
              </div>
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: '1px solid var(--line)',
                }}
              >
                {renderRowAction(row)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
