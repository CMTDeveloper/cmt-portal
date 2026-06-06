'use client';

import { useState } from 'react';
import { SetuIcon, toast } from '@cmt/ui';
import { SectionLabel } from '@/features/family/components/atoms';
import {
  cancelSignup,
  fetchMySignups,
  fetchOpportunities,
  signUp,
  type SevaMySignup,
  type SevaOppView,
} from './seva-browser-client';

interface SevaBrowserProps {
  currentSevaYear: string | null;
  hoursPerYear: number;
  hoursEarned: number;
  initialOpportunities: SevaOppView[];
  initialMySignups: SevaMySignup[];
  members: { mid: string; name: string }[];
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
  padding: '12px 13px',
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

/** A small icon + label cell for the opportunity metadata row. */
function MetaItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--body-text)' }}>
      <span aria-hidden style={{ display: 'inline-flex', color: 'var(--muted)' }}>
        {icon}
      </span>
      {children}
    </span>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export function SevaBrowser({
  currentSevaYear,
  hoursPerYear,
  hoursEarned,
  initialOpportunities,
  initialMySignups,
  members,
}: SevaBrowserProps) {
  const [opportunities, setOpportunities] = useState<SevaOppView[]>(initialOpportunities);
  const [mySignups, setMySignups] = useState<SevaMySignup[]>(initialMySignups);

  // Which opportunity has its inline sign-up control open, and the member it credits.
  const [openSignupId, setOpenSignupId] = useState<string | null>(null);
  const [creditMid, setCreditMid] = useState<string>('');
  // Guards double-clicks: the oppId / signupId currently mutating.
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Subtle hover-lift state, keyed by id (card hover is per-card).
  const [hoverId, setHoverId] = useState<string | null>(null);

  const memberNameByMid = new Map(members.map((m) => [m.mid, m.name]));
  const isEmpty = currentSevaYear == null || opportunities.length === 0;
  const pendingSignups = mySignups.filter((s) => s.status === 'signed-up');
  const completedSignups = mySignups.filter((s) => s.status === 'completed');
  const signedUpCount = opportunities.filter((o) => o.mySignupStatus === 'signed-up').length;

  async function refetch() {
    const [opps, signups] = await Promise.all([fetchOpportunities(), fetchMySignups()]);
    setOpportunities(opps.opportunities);
    setMySignups(signups);
  }

  function openSignup(oppId: string) {
    setCreditMid('');
    setOpenSignupId(oppId);
  }

  async function confirmSignup(oppId: string) {
    if (pendingId) return;
    setPendingId(oppId);
    const res = await signUp(oppId, creditMid || null);
    setPendingId(null);
    if (!res.ok) {
      if (res.error === 'opportunity-full') toast.error('That opportunity just filled up');
      else if (res.error === 'not-open') toast.error('Sign-ups are closed for this one');
      else if (res.error === 'already-resolved') toast.error('This seva is already recorded for your family');
      else toast.error('Could not sign up — please try again');
      return;
    }
    setOpenSignupId(null);
    setCreditMid('');
    await refetch();
    toast.success("You're signed up!");
  }

  async function doCancel(signupId: string) {
    if (pendingId) return;
    if (!confirm('Cancel this sign-up?')) return;
    setPendingId(signupId);
    const res = await cancelSignup(signupId);
    setPendingId(null);
    if (!res.ok) {
      toast.error('Could not cancel — please try again');
      return;
    }
    await refetch();
    toast.success('Sign-up cancelled');
  }

  // Cancel from an opportunity card: find the active signup for that opp.
  async function cancelForOpp(oppId: string) {
    const sig = mySignups.find((s) => s.oppId === oppId && s.status === 'signed-up');
    if (!sig) return;
    await doCancel(sig.signupId);
  }

  // Render-helper (called as a function, never a nested component — a nested
  // component remounts on every render and steals input focus / select state).
  function renderOppAction(o: SevaOppView) {
    const isSignedUp = o.mySignupStatus === 'signed-up';
    const isFull = o.spotsLeft === 0;
    const pending = pendingId === o.oppId;

    if (o.mySignupStatus === 'completed' || o.mySignupStatus === 'no-show') {
      const done = o.mySignupStatus === 'completed';
      return (
        <span
          className="pill"
          style={{
            background: done ? 'var(--accentSoft)' : 'var(--surface2)',
            color: done ? 'var(--accentDeep)' : 'var(--muted)',
            fontWeight: 600,
            fontSize: 12,
            padding: '6px 12px',
          }}
        >
          {done ? <SetuIcon.check width={13} height={13} /> : null} {done ? 'Completed' : 'Marked absent'}
        </span>
      );
    }

    if (isSignedUp) {
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            className="pill"
            style={{
              background: 'var(--accentSoft)',
              color: 'var(--accentDeep)',
              fontWeight: 600,
              fontSize: 12,
              padding: '6px 12px',
            }}
          >
            <SetuIcon.check width={13} height={13} /> Signed up
          </span>
          <button
            type="button"
            className="btn btn--g"
            onClick={() => cancelForOpp(o.oppId)}
            disabled={pendingId !== null}
            style={{ minHeight: 44, marginLeft: 'auto' }}
          >
            Cancel
          </button>
        </div>
      );
    }

    if (isFull) {
      return (
        <button
          type="button"
          className="btn btn--s btn--block"
          disabled
          style={{ minHeight: 46, opacity: 0.65, cursor: 'not-allowed' }}
        >
          Full
        </button>
      );
    }

    if (openSignupId === o.oppId) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={labelStyle} htmlFor={`credit-${o.oppId}`}>
            Credit a member
            <select
              id={`credit-${o.oppId}`}
              aria-label="Credit a member"
              value={creditMid}
              onChange={(ev) => setCreditMid(ev.target.value)}
              style={fieldStyle}
            >
              <option value="">Whole family</option>
              {members.map((m) => (
                <option key={m.mid} value={m.mid}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--p"
              onClick={() => confirmSignup(o.oppId)}
              disabled={pending}
              style={{ flex: '1 1 140px', minHeight: 46, padding: '13px 24px' }}
            >
              {pending ? 'Signing up…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn btn--s"
              onClick={() => setOpenSignupId(null)}
              disabled={pending}
              style={{ flex: '1 1 100px', minHeight: 46 }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        type="button"
        className="btn btn--p btn--block"
        onClick={() => openSignup(o.oppId)}
        style={{ minHeight: 46 }}
      >
        <SetuIcon.heart width={16} height={16} /> Sign up
      </button>
    );
  }

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 24 }}>
        <p style={eyebrowStyle}>Seva</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 8, lineHeight: 1.08 }}>
          Lend a hand
        </h1>
        <p style={{ fontSize: 15, color: 'var(--body-text)', marginTop: 12, maxWidth: 540, lineHeight: 1.55 }}>
          Seva is selfless service offered with a joyful heart. Pick something that fits your week — every hour helps
          our community thrive.
        </p>
      </header>

      {/* Goal band — warm, gratifying, accent-forward */}
      <div
        className="card"
        style={{
          background: 'var(--accentSoft)',
          border: '1px solid transparent',
          padding: 'clamp(18px, 4.5vw, 24px)',
          marginBottom: 26,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            flex: '0 0 auto',
            borderRadius: 999,
            background: 'var(--surface)',
            color: 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(217, 102, 66, 0.18)',
          }}
        >
          <SetuIcon.heart width={24} height={24} />
        </div>
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accentDeep)', letterSpacing: '.04em' }}>
            OUR FAMILY GOAL{currentSevaYear ? ` · ${currentSevaYear}` : ''}
          </div>
          {/* "{earned} of {target}" is a bare text interpolation (no wrapping
              element) so the full "{earned} of {target} hours of seva this year"
              line stays a single contiguous text node the goal-header test can
              match. The whole line carries the confident accent treatment
              instead of enlarging only the number. A real progress bar lands in
              Slice D — this is earned progress as plain text for now. */}
          <p
            style={{
              marginTop: 4,
              fontSize: 'clamp(22px, 6.5vw, 28px)',
              fontWeight: 600,
              color: 'var(--accentDeep)',
              letterSpacing: '-0.02em',
              lineHeight: 1.12,
            }}
          >
            {hoursEarned} of {hoursPerYear} hours of seva this year
          </p>
          {signedUpCount > 0 && (
            <div style={{ fontSize: 13, color: 'var(--accentDeep)', marginTop: 8, fontWeight: 500 }}>
              You&apos;re signed up for {signedUpCount} {signedUpCount === 1 ? 'opportunity' : 'opportunities'} — thank you.
            </div>
          )}
        </div>
      </div>

      {/* Opportunities */}
      {isEmpty ? (
        <div
          className="card"
          style={{
            padding: 'clamp(32px, 8vw, 48px) 24px',
            textAlign: 'center',
            background: 'var(--surface)',
          }}
        >
          {/* Heart-in-rosette motif built from existing tokens */}
          <div
            aria-hidden
            style={{
              width: 72,
              height: 72,
              borderRadius: 999,
              background: 'var(--accentSoft)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: 'var(--surface)',
                color: 'var(--accent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SetuIcon.heart width={22} height={22} />
            </div>
          </div>
          <p style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 600, letterSpacing: '-0.01em' }}>
            No seva opportunities just yet
          </p>
          <p
            style={{
              fontSize: 14,
              color: 'var(--muted)',
              marginTop: 8,
              maxWidth: 360,
              marginInline: 'auto',
              lineHeight: 1.55,
            }}
          >
            New ways to help out are posted here through the year. Check back soon — there&apos;ll be a place for you.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {opportunities.map((o) => {
            const showSpots = o.spotsLeft !== null;
            const isSignedUp = o.mySignupStatus === 'signed-up';
            const isFull = o.spotsLeft === 0;
            const lowSpots = o.spotsLeft !== null && o.spotsLeft > 0 && o.spotsLeft <= 3;
            const hovered = hoverId === o.oppId;
            return (
              <div
                key={o.oppId}
                className="card"
                onMouseEnter={() => setHoverId(o.oppId)}
                onMouseLeave={() => setHoverId((h) => (h === o.oppId ? null : h))}
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderColor: isSignedUp ? 'var(--accent)' : 'var(--line)',
                  boxShadow: hovered ? '0 8px 24px rgba(15, 26, 34, 0.08)' : 'none',
                  transition: 'box-shadow .14s ease, border-color .14s ease',
                }}
              >
                {/* Confirming accent rail when you're signed up */}
                {isSignedUp && <div aria-hidden style={{ height: 3, background: 'var(--accent)' }} />}

                <div style={{ padding: 'clamp(16px, 4vw, 22px)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          color: 'var(--ink)',
                          lineHeight: 1.25,
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {o.title}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 10,
                          marginTop: 10,
                          fontSize: 13.5,
                        }}
                      >
                        <MetaItem icon={<SetuIcon.calendar width={14} height={14} />}>{fmtDate(o.date)}</MetaItem>
                        <Dot />
                        <span style={{ color: 'var(--body-text)', fontWeight: 600 }}>{o.defaultHours} hrs</span>
                        {o.location && (
                          <>
                            <Dot />
                            <MetaItem icon={<SetuIcon.home width={14} height={14} />}>{o.location}</MetaItem>
                          </>
                        )}
                      </div>
                    </div>
                    {showSpots && (
                      <span
                        className="pill"
                        style={{
                          flex: '0 0 auto',
                          fontWeight: 600,
                          fontSize: 11.5,
                          padding: '5px 11px',
                          background: isFull
                            ? 'var(--surface2)'
                            : lowSpots
                              ? 'var(--accentSoft)'
                              : 'var(--surface2)',
                          color: isFull ? 'var(--muted)' : lowSpots ? 'var(--accentDeep)' : 'var(--body-text)',
                        }}
                      >
                        {isFull ? 'Full' : `${o.spotsLeft} left`}
                      </span>
                    )}
                  </div>

                  {o.description && (
                    <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.55 }}>
                      {o.description}
                    </p>
                  )}

                  <div
                    style={{
                      marginTop: 18,
                      paddingTop: 16,
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    {renderOppAction(o)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* My sign-ups — pending (cancellable) first, then completed (hours
          credited, not cancellable). The empty state shows only when both
          lists are empty; no-show rows are intentionally omitted here. */}
      <SectionLabel>My sign-ups</SectionLabel>
      {pendingSignups.length === 0 && completedSignups.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '20px 18px',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 34,
              height: 34,
              flex: '0 0 auto',
              borderRadius: 999,
              background: 'var(--accentSoft)',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SetuIcon.heart width={16} height={16} />
          </span>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            You haven&apos;t signed up for anything yet — pick an opportunity above to get started.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...pendingSignups, ...completedSignups].map((s) => {
            const creditedName = s.mid ? (memberNameByMid.get(s.mid) ?? null) : null;
            const isDone = s.status === 'completed';
            return (
              <div
                key={s.signupId}
                className="card"
                style={{
                  padding: 'clamp(14px, 3.5vw, 18px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
                  <span
                    aria-hidden
                    style={{
                      width: 36,
                      height: 36,
                      flex: '0 0 auto',
                      borderRadius: 999,
                      background: 'var(--accentSoft)',
                      color: 'var(--accentDeep)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <SetuIcon.check width={16} height={16} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                      {s.opportunity?.title ?? 'Seva opportunity'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 4,
                        fontSize: 12.5,
                        color: 'var(--muted)',
                      }}
                    >
                      {s.opportunity && <span>{fmtDate(s.opportunity.date)}</span>}
                      {creditedName && (
                        <>
                          <Dot />
                          <span>For {creditedName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {isDone ? (
                  <span
                    className="pill"
                    style={{
                      flex: '0 0 auto',
                      background: 'var(--accentSoft)',
                      color: 'var(--accentDeep)',
                      fontWeight: 600,
                      fontSize: 12.5,
                      padding: '6px 12px',
                    }}
                  >
                    {s.hoursAwarded} hrs
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--g"
                    onClick={() => doCancel(s.signupId)}
                    disabled={pendingId !== null}
                    style={{ minHeight: 44, flex: '0 0 auto' }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
