'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import { CHILD_GRADE_OPTIONS } from '@cmt/shared-domain';

interface VisitorRow {
  name: string;
  grade: string;
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
  alreadyConfirmed: boolean;
}
interface ConfirmedRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  status: string;
}
interface VisitorsView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string | null;
  date: string;
  doorVisitors: VisitorRow[];
  confirmed: ConfirmedRow[];
}

interface VisitorsPanelProps {
  levelId: string;
  levelName: string;
  date: string;
}

/** "Arjun Sharma" → { first: "Arjun", last: "Sharma" }; "Arjun" → { first, last:"" } */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  const first = parts.shift() ?? '';
  return { first, last: parts.join(' ') };
}

/** First glyph of a name for the row avatar; falls back to a neutral dot. */
function initial(name: string): string {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : '·';
}

const field: React.CSSProperties = {
  padding: '11px 12px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--bg)',
  fontSize: 15,
  fontFamily: 'var(--body)',
  color: 'var(--ink)',
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 48,
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--body-text)',
  letterSpacing: '0.01em',
  marginBottom: 6,
  display: 'block',
};

const sectionHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

export function VisitorsPanel({ levelId, levelName, date }: VisitorsPanelProps) {
  const [view, setView] = useState<VisitorsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [grade, setGrade] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/setu/teacher/visitors?levelId=${encodeURIComponent(levelId)}&date=${date}`);
      if (res.ok) setView(((await res.json()).view as VisitorsView) ?? null);
    } finally {
      setLoading(false);
    }
  }, [levelId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  function submitAdd(payload: {
    firstName: string;
    lastName: string;
    schoolGrade: string | null;
    parentEmail: string | null;
    parentPhone: string | null;
  }) {
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/visitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levelId, date, ...payload }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error === 'not-your-class' ? 'Not your class' : 'Could not add visitor');
          return;
        }
        const j = await res.json();
        toast.success(
          j.claimable
            ? 'Visitor marked present. The parent can sign in with that contact to manage the family.'
            : 'Visitor marked present. Add a parent contact later so they can claim the family.',
        );
        setFirst(''); setLast(''); setGrade(''); setEmail(''); setPhone('');
        await load();
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  function onQuickAdd(ev: React.FormEvent) {
    ev.preventDefault();
    if (!first.trim()) {
      toast.error('Enter at least the visitor’s first name.');
      return;
    }
    submitAdd({
      firstName: first.trim(),
      lastName: last.trim(),
      schoolGrade: grade.trim() || null,
      parentEmail: email.trim() || null,
      parentPhone: phone.trim() || null,
    });
  }

  function confirmDoorGuest(g: VisitorRow) {
    const { first: f, last: l } = splitName(g.name);
    submitAdd({
      firstName: f || g.name || 'Guest',
      lastName: l,
      schoolGrade: g.grade.trim() || null,
      parentEmail: g.parentEmail || null,
      parentPhone: g.phone || null,
    });
  }

  const doorCount = view?.doorVisitors.length ?? 0;
  const pendingDoor = view?.doorVisitors.filter((g) => !g.alreadyConfirmed).length ?? 0;
  const confirmedCount = view?.confirmed.length ?? 0;

  return (
    <div style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }}>
      <header style={{ marginBottom: 20 }}>
        <Link
          href={`/teacher/levels/${levelId}/attendance?date=${date}`}
          style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}
        >
          ← Back to attendance
        </Link>
        <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 10, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Visitors</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{levelName} · {date}</p>

        {!loading && view && (doorCount > 0 || confirmedCount > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {pendingDoor > 0 && (
              <span
                className="pill"
                style={{ fontSize: 12, fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}
              >
                {pendingDoor} waiting at the door
              </span>
            )}
            {confirmedCount > 0 && (
              <span
                className="pill"
                style={{ fontSize: 12, fontWeight: 600, background: 'var(--setu-ok-soft)', color: 'var(--ok)' }}
              >
                ✓ {confirmedCount} marked present
              </span>
            )}
          </div>
        )}
      </header>

      {/* Quick-add a walk-in — the hero action */}
      <form
        onSubmit={onQuickAdd}
        className="card"
        style={{ overflow: 'hidden', marginBottom: 22, boxShadow: 'var(--setu-elev-2, 0 4px 14px rgba(15,26,34,0.06))' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            background: 'var(--accentSoft)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 'var(--radiusSm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 19,
              fontWeight: 600,
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            +
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accentDeep)' }}>Add a visitor</div>
            <div style={{ fontSize: 12, color: 'var(--accentDeep)', opacity: 0.8, marginTop: 1 }}>
              A first name is all you need to mark a walk-in present.
            </div>
          </div>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <span style={label}>
                First name <span style={{ color: 'var(--accent)' }}>*</span>
              </span>
              <input
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                placeholder="First name"
                aria-label="First name"
                autoComplete="off"
                style={field}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <span style={label}>Last name</span>
              <input
                value={last}
                onChange={(e) => setLast(e.target.value)}
                placeholder="Last name (optional)"
                aria-label="Last name"
                autoComplete="off"
                style={field}
              />
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <span style={label}>Grade</span>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              aria-label="Grade"
              style={field}
            >
              <option value="">Grade (optional)</option>
              {CHILD_GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <span style={label}>Parent email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Parent email (optional)"
                aria-label="Parent email"
                autoComplete="off"
                style={field}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <span style={label}>Parent phone</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Parent phone (optional)"
                aria-label="Parent phone"
                autoComplete="off"
                style={field}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="btn btn--p btn--block"
            style={{ fontSize: 15, padding: '13px 20px', minHeight: 50, opacity: pending ? 0.65 : 1 }}
          >
            {pending ? 'Saving…' : 'Add visitor'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            A parent contact can be added later so the family can claim their account.
          </p>
        </div>
      </form>

      {/* Door guests matched to this class — the confirmation queue */}
      <section style={{ marginBottom: 22 }}>
        <div className="between" style={{ marginBottom: 10, gap: 8 }}>
          <h2 style={sectionHeading}>Checked in at the door</h2>
          {!loading && pendingDoor > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accentDeep)' }}>
              {pendingDoor} to confirm
            </span>
          )}
        </div>

        {loading ? (
          <div className="card" style={{ padding: 18, color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
        ) : !view || view.doorVisitors.length === 0 ? (
          <div
            className="card"
            style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}
          >
            <div
              aria-hidden
              style={{
                width: 40,
                height: 40,
                margin: '0 auto 10px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                background: 'var(--surface2)',
                color: 'var(--muted)',
              }}
            >
              ☷
            </div>
            No door guests match this class for {date}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {view.doorVisitors.map((g, i) => {
              const settled = g.alreadyConfirmed;
              return (
                <div
                  key={`${g.parentEmail}:${g.name}:${i}`}
                  className="card"
                  style={{
                    padding: '14px 16px',
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    borderColor: settled ? 'var(--ok)' : 'var(--line)',
                    background: settled
                      ? 'linear-gradient(0deg, var(--setu-ok-soft), var(--setu-ok-soft)), var(--surface)'
                      : 'var(--surface)',
                    transition: 'border-color .15s ease, background .15s ease',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      background: settled ? 'var(--ok)' : 'transparent',
                      transition: 'background .15s ease',
                    }}
                  />
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 15,
                      fontWeight: 600,
                      background: settled ? 'var(--setu-ok-soft)' : 'var(--info-soft)',
                      color: settled ? 'var(--ok)' : 'var(--info-deep)',
                    }}
                  >
                    {initial(g.name)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.name || '(unnamed)'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      <span
                        className="pill"
                        style={{ fontSize: 11, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}
                      >
                        · {g.grade ? `Grade ${g.grade}` : 'Grade ?'}
                      </span>
                      {g.parentName && (
                        <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.parentName}
                        </span>
                      )}
                    </div>
                  </div>
                  {settled ? (
                    <span
                      className="pill"
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'var(--ok)',
                        color: '#fff',
                        padding: '6px 12px',
                      }}
                    >
                      ✓ added
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => confirmDoorGuest(g)}
                      className="btn btn--p"
                      style={{ flexShrink: 0, fontSize: 14, padding: '11px 18px', minHeight: 44, whiteSpace: 'nowrap', opacity: pending ? 0.65 : 1 }}
                    >
                      Confirm
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Already marked as guests in the portal — reassurance */}
      {view && view.confirmed.length > 0 && (
        <section>
          <h2 style={{ ...sectionHeading, marginBottom: 10 }}>Marked present today</h2>
          <div className="card" style={{ padding: 6, display: 'flex', flexDirection: 'column' }}>
            {view.confirmed.map((c, i) => (
              <div
                key={c.mid}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  minHeight: 44,
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <Link
                  href={`/teacher/students/${c.mid}`}
                  className="row"
                  style={{ gap: 10, fontSize: 14, textDecoration: 'none', color: 'var(--body-text)', minWidth: 0 }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                      background: 'var(--setu-ok-soft)',
                      color: 'var(--ok)',
                    }}
                  >
                    {initial(c.firstName)}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.firstName} {c.lastName}
                  </span>
                </Link>
                <span
                  className="pill"
                  style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, background: 'var(--setu-ok-soft)', color: 'var(--ok)', textTransform: 'capitalize' }}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
