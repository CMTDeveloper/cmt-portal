'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';

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

const field: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--bg)',
  fontSize: 14,
  fontFamily: 'var(--body)',
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 44,
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

  return (
    <div style={{ paddingBottom: 40 }}>
      <header style={{ marginBottom: 18 }}>
        <Link href={`/teacher/levels/${levelId}/attendance?date=${date}`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}>
          ← Back to attendance
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 10, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Visitors</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{levelName} · {date}</p>
      </header>

      {/* Quick-add a walk-in */}
      <form onSubmit={onQuickAdd} className="card" style={{ padding: 16, marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Add a visitor</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" aria-label="First name" style={field} />
          <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name (optional)" aria-label="Last name" style={field} />
        </div>
        <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Grade (optional)" aria-label="Grade" style={field} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Parent email (optional)" aria-label="Parent email" style={field} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Parent phone (optional)" aria-label="Parent phone" style={field} />
        <button type="submit" disabled={pending} className="btn btn--p" style={{ fontSize: 15, padding: '12px 20px', minHeight: 48, alignSelf: 'flex-start', opacity: pending ? 0.65 : 1 }}>
          {pending ? 'Saving…' : 'Add visitor'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Name is enough to mark a walk-in present now. A parent contact can be added later so they can claim the family.
        </p>
      </form>

      {/* Door guests matched to this class */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Checked in at the door
        </h2>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
        ) : !view || view.doorVisitors.length === 0 ? (
          <div className="card" style={{ padding: 18, color: 'var(--muted)', fontSize: 14 }}>
            No door guests match this class for {date}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {view.doorVisitors.map((g) => (
              <div key={`${g.parentEmail}:${g.name}`} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{g.name || '(unnamed)'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    {g.grade ? `Grade ${g.grade}` : 'Grade unknown'}{g.parentName ? ` · ${g.parentName}` : ''}
                  </div>
                </div>
                {g.alreadyConfirmed ? (
                  <span className="pill" style={{ fontSize: 12, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}>✓ added</span>
                ) : (
                  <button type="button" disabled={pending} onClick={() => confirmDoorGuest(g)} className="btn btn--p" style={{ fontSize: 14, padding: '10px 16px', minHeight: 44, whiteSpace: 'nowrap' }}>
                    Confirm
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Already marked as guests in the portal */}
      {view && view.confirmed.length > 0 && (
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Marked present today
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {view.confirmed.map((c) => (
              <div key={c.mid} className="card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link href={`/teacher/students/${c.mid}`} style={{ fontSize: 14, textDecoration: 'none', color: 'var(--body-text)' }}>
                  {c.firstName} {c.lastName}
                </Link>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
