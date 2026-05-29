'use client';

import { useState, useTransition } from 'react';
import { toast } from '@cmt/ui';
import type { LevelRow } from './levels-table';

interface AssignTeacherFormProps {
  levels: LevelRow[];
}

/**
 * Ref-centric assignment: enter a teacher's member id (mid) or standalone
 * teacher id (tid), tick the levels they cover, save. Maps 1:1 to
 * POST /api/admin/teacher-assignments which sets the FULL level set for a ref.
 * Writable by admin AND welcome-team. The teacher capability lands on the
 * person's next OTP sign-in.
 */
export function AssignTeacherForm({ levels }: AssignTeacherFormProps) {
  const [ref, setRef] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const enabledLevels = levels.filter((l) => l.enabled);

  function toggle(levelId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(levelId)) next.delete(levelId);
      else next.add(levelId);
      return next;
    });
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const trimmed = ref.trim();
    if (!trimmed) {
      toast.error('Enter a member id (mid) or teacher id (tid).');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/teacher-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: trimmed, levelIds: [...selected] }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error(json.error ?? 'Assignment failed');
          return;
        }
        toast.success(
          selected.size === 0
            ? `Cleared all level assignments for ${trimmed}.`
            : `Assigned ${trimmed} to ${selected.size} level${selected.size === 1 ? '' : 's'}. Takes effect on their next sign-in.`,
        );
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={labelStyle}>
        Teacher ref (member mid or teacher tid)
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="CMT-XXXX1111-01" style={fieldStyle} />
      </label>

      <div>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Levels this teacher covers</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          Ticking sets the teacher&apos;s full level set (unticking removes them). Re-enter the same ref to adjust later.
        </div>
        {enabledLevels.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No enabled levels to assign.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {enabledLevels.map((l) => (
              <label key={l.levelId} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
                <input type="checkbox" checked={selected.has(l.levelId)} onChange={() => toggle(l.levelId)} style={{ accentColor: 'var(--accent)' }} />
                <span><strong>{l.location}</strong> · {l.levelName} <span style={{ color: 'var(--muted)' }}>({l.periodLabel})</span></span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <button type="submit" disabled={pending} className="btn btn--p" style={{ fontSize: 13, padding: '8px 18px', opacity: pending ? 0.6 : 1 }}>
          {pending ? 'Saving…' : 'Save assignment'}
        </button>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' };
const fieldStyle: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--body)', boxSizing: 'border-box', maxWidth: 360 };
