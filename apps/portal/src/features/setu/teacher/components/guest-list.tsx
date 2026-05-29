'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import type { SetuAttendanceStatus } from '@cmt/shared-domain';

interface GuestRow {
  aid: string;
  mid: string;
  fid: string;
  date: string;
  status: SetuAttendanceStatus;
}

interface GuestListProps {
  levelId: string;
  levelName: string;
  date: string;
}

export function GuestList({ levelId, levelName, date }: GuestListProps) {
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [mid, setMid] = useState('');
  const [status, setStatus] = useState<SetuAttendanceStatus>('present');
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/setu/teacher/guests?levelId=${encodeURIComponent(levelId)}&date=${date}`);
      if (res.ok) setGuests(((await res.json()).guests as GuestRow[]) ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [levelId, date]);

  function addGuest(ev: React.FormEvent) {
    ev.preventDefault();
    const trimmed = mid.trim();
    if (!trimmed) {
      toast.error('Enter the visiting student’s member id (mid).');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/setu/teacher/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId, date, mid: trimmed, status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error === 'member-not-found' ? 'No member found with that id' : j.error === 'not-your-class' ? 'Not your class' : 'Could not mark guest');
        return;
      }
      const j = await res.json();
      toast.success(j.autoEnrolled ? 'Guest marked — family auto-enrolled for this period.' : 'Guest marked.');
      setMid('');
      await load();
    });
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <header style={{ marginBottom: 16 }}>
        <Link href={`/teacher/levels/${levelId}/attendance?date=${date}`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← Back to attendance</Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>Guests · {levelName}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Visiting students marked at this class on {date}.</p>
      </header>

      <form onSubmit={addGuest} className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Mark a visiting student</div>
        <input value={mid} onChange={(e) => setMid(e.target.value)} placeholder="Member id (e.g. CMT-XXXX1111-02)" style={{ padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, fontFamily: 'var(--body)' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value as SetuAttendanceStatus)} style={{ padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13 }}>
            <option value="present">Present</option>
            <option value="late">Late</option>
          </select>
          <button type="submit" disabled={pending} className="btn btn--p" style={{ fontSize: 13, padding: '8px 18px' }}>{pending ? 'Saving…' : 'Mark guest'}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          A search-and-add picker (and on-the-spot registration for unregistered children) is coming — for now enter the visiting student’s member id.
        </div>
      </form>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
      ) : guests.length === 0 ? (
        <div className="card" style={{ padding: 20, color: 'var(--muted)', fontSize: 14 }}>No guests marked yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {guests.map((g) => (
            <div key={g.aid} className="card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
              <Link href={`/teacher/students/${g.mid}`} style={{ fontSize: 14, fontFamily: 'var(--mono)', textDecoration: 'none', color: 'var(--body-text)' }}>{g.mid}</Link>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{g.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
