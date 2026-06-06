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
  padding: '11px 13px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--surface)',
  fontSize: 15,
  color: 'var(--ink)',
  fontFamily: 'var(--body)',
  boxSizing: 'border-box',
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

function Dot() {
  return (
    <span aria-hidden style={{ color: 'var(--line2)' }}>
      ·
    </span>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export function SevaBrowser({
  currentSevaYear,
  hoursPerYear,
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

  const memberNameByMid = new Map(members.map((m) => [m.mid, m.name]));
  const isEmpty = currentSevaYear == null || opportunities.length === 0;
  const activeSignups = mySignups.filter((s) => s.status === 'signed-up');

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

    if (isSignedUp) {
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontWeight: 600 }}>
            Signed up ✓
          </span>
          <button
            type="button"
            className="btn btn--g"
            onClick={() => cancelForOpp(o.oppId)}
            disabled={pendingId !== null}
            style={{ minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      );
    }

    if (isFull) {
      return (
        <button type="button" className="btn btn--g" disabled style={{ minHeight: 44, opacity: 0.7 }}>
          Full
        </button>
      );
    }

    if (openSignupId === o.oppId) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              style={{ minHeight: 44, padding: '12px 24px' }}
            >
              {pending ? 'Signing up…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn btn--g"
              onClick={() => setOpenSignupId(null)}
              disabled={pending}
              style={{ minHeight: 44 }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <button type="button" className="btn btn--p" onClick={() => openSignup(o.oppId)} style={{ minHeight: 44 }}>
        <SetuIcon.heart /> Sign up
      </button>
    );
  }

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 28 }}>
        <p style={eyebrowStyle}>Seva</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 8, lineHeight: 1.08 }}>
          Seva opportunities
        </h1>
        <p style={{ fontSize: 15, color: 'var(--body-text)', marginTop: 12, maxWidth: 560, lineHeight: 1.55 }}>
          Lend a hand — our family goal is {hoursPerYear} hours of seva this year.
        </p>
      </header>

      {/* Opportunities */}
      {isEmpty ? (
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
          <p style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 600 }}>No seva opportunities posted yet</p>
          <p
            style={{
              fontSize: 14,
              color: 'var(--muted)',
              marginTop: 8,
              maxWidth: 340,
              marginInline: 'auto',
              lineHeight: 1.5,
            }}
          >
            Check back soon — new ways to help out are posted here through the year.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {opportunities.map((o) => {
            const showSpots = o.spotsLeft !== null;
            return (
              <div key={o.oppId} className="card" style={{ padding: 'clamp(16px, 4vw, 22px)' }}>
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
                        gap: 8,
                        marginTop: 8,
                        fontSize: 13.5,
                        color: 'var(--body-text)',
                      }}
                    >
                      <span>{fmtDate(o.date)}</span>
                      <Dot />
                      <span>{o.defaultHours} hrs</span>
                      {o.location && (
                        <>
                          <Dot />
                          <span>{o.location}</span>
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
                        background: o.spotsLeft === 0 ? 'var(--surface2)' : 'var(--accentSoft)',
                        color: o.spotsLeft === 0 ? 'var(--muted)' : 'var(--accentDeep)',
                      }}
                    >
                      {o.spotsLeft === 0 ? 'Full' : `${o.spotsLeft} spots left`}
                    </span>
                  )}
                </div>

                {o.description && (
                  <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.55 }}>
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
            );
          })}
        </div>
      )}

      {/* My sign-ups */}
      <SectionLabel>My sign-ups</SectionLabel>
      {activeSignups.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>You haven&apos;t signed up for anything yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeSignups.map((s) => {
            const creditedName = s.mid ? (memberNameByMid.get(s.mid) ?? null) : null;
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
                      fontSize: 13,
                      color: 'var(--body-text)',
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
                <button
                  type="button"
                  className="btn btn--g"
                  onClick={() => doCancel(s.signupId)}
                  disabled={pendingId !== null}
                  style={{ minHeight: 44, flex: '0 0 auto' }}
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
