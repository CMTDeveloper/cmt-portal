'use client';

import { useState, useTransition } from 'react';
import { toast } from '@cmt/ui';
import type { LevelRow } from './levels-table';

interface AssignTeacherFormProps {
  levels: LevelRow[];
  onAssignmentSaved?: (change: { ref: string; added: string[]; removed: string[] }) => void;
}

/**
 * Email-centric assignment: enter the teacher's sign-in email, tick the levels
 * they cover, save. POST /api/admin/teacher-assignments resolves the email to
 * the member id and sets that teacher's FULL level set.
 */
export function AssignTeacherForm({ levels, onAssignmentSaved }: AssignTeacherFormProps) {
  const [teacherEmail, setTeacherEmail] = useState('');
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
    const trimmed = teacherEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Enter the teacher email.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/teacher-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherEmail: trimmed, levelIds: [...selected] }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error(errorCopy(json.error) ?? 'Assignment failed');
          return;
        }
        const json = (await res.json()) as { ref: string; added?: string[]; removed?: string[] };
        onAssignmentSaved?.({ ref: json.ref, added: json.added ?? [], removed: json.removed ?? [] });
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
        Teacher email
        <input
          type="email"
          value={teacherEmail}
          onChange={(e) => setTeacherEmail(e.target.value)}
          placeholder="teacher@example.com"
          style={fieldStyle}
        />
      </label>

      <div>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Levels this teacher covers</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          Ticking sets the teacher&apos;s full level set. Unticked levels are removed when you save.
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
          {pending ? 'Saving…' : selected.size === 0 ? 'Clear assignments' : `Save ${selected.size} level${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}

function errorCopy(code: unknown): string | null {
  if (code === 'teacher-not-found') return 'No registered member was found for that email.';
  if (code === 'teacher-not-active') return 'That member cannot sign in yet. Approve their family access first.';
  if (code === 'invalid-teacher-email') return 'Enter a valid teacher email.';
  return typeof code === 'string' ? code : null;
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' };
const fieldStyle: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--body)', boxSizing: 'border-box', maxWidth: 360 };
