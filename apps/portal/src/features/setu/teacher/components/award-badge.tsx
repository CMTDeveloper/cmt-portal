'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';
import type { ChildAchievement } from '@/features/setu/members/get-child-profile';

interface ProgramOption {
  key: string;
  label: string;
}

interface AwardBadgeProps {
  mid: string;
  achievements: ChildAchievement[];
  programOptions: ProgramOption[];
}

const fieldLabel = { fontSize: 13, fontWeight: 600, color: 'var(--body-text)' } as const;

// A standalone checkmark glyph so the "earned" medallion reads without pulling in
// SetuIcon (kept inline to stay independent of the @cmt/ui mock in tests).
function CheckGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// A small plus glyph for the "award a new badge" header rosette.
function PlusGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function formatAwardedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
}

export function AwardBadge({ mid, achievements, programOptions }: AwardBadgeProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [programKey, setProgramKey] = useState('');
  const [pending, startTransition] = useTransition();

  const labelFor = (key: string | null): string | null =>
    key ? (programOptions.find((p) => p.key === key)?.label ?? key) : null;

  function award() {
    const t = title.trim();
    if (!t) {
      toast.error('Enter a badge title');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/achievements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mid, title: t, description: description.trim() || undefined, programKey: programKey || null }),
        });
        if (!res.ok) { toast.error('Could not award badge'); return; }
        toast.success('Badge awarded');
        setTitle(''); setDescription(''); setProgramKey('');
        router.refresh();
      } catch { toast.error('Network error — please try again.'); }
    });
  }

  function revoke(achId: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/setu/teacher/achievements/${achId}?mid=${encodeURIComponent(mid)}`, { method: 'DELETE' });
        if (!res.ok) { toast.error('Could not revoke badge'); return; }
        toast.success('Badge revoked');
        router.refresh();
      } catch { toast.error('Network error — please try again.'); }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {achievements.length === 0 ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radiusSm)',
            background: 'var(--surface2)',
            fontSize: 13,
            color: 'var(--muted)',
          }}
        >
          No badges yet — award one below to celebrate progress.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {achievements.map((a) => (
            <div
              key={a.achId}
              className="card"
              style={{
                padding: '10px 12px 10px 11px',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                background: 'var(--accentSoft)',
                borderColor: 'var(--accent)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 30,
                  height: 30,
                  flex: '0 0 auto',
                  borderRadius: 999,
                  background: 'var(--surface)',
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 0 2px var(--accent)',
                }}
              >
                <CheckGlyph />
              </span>
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--accentDeep)',
                    lineHeight: 1.25,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {a.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {labelFor(a.programKey) ? `${labelFor(a.programKey)} · ` : ''}{formatAwardedAt(a.awardedAt)}
                </div>
              </div>
              <button type="button" onClick={() => revoke(a.achId)} disabled={pending} className="btn btn--s" style={{ flex: '0 0 auto', fontSize: 13 }}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 30,
              height: 30,
              flex: '0 0 auto',
              borderRadius: 999,
              background: 'var(--accentSoft)',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlusGlyph />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Award a new badge
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={fieldLabel}>Badge title</span>
          <input aria-label="Badge title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Om Award" maxLength={80} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={fieldLabel}>Description (optional)</span>
          <input aria-label="Badge description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Recited chapter 12" maxLength={500} />
        </div>
        {programOptions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={fieldLabel}>Program (optional)</span>
            <select aria-label="Program" className="input" value={programKey} onChange={(e) => setProgramKey(e.target.value)}>
              <option value="">General (no program)</option>
              {programOptions.map((p) => (<option key={p.key} value={p.key}>{p.label}</option>))}
            </select>
          </div>
        )}
        <div style={{ marginTop: 2 }}>
          <button type="button" onClick={award} disabled={pending} className="btn btn--p" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {!pending && <CheckGlyph size={15} />}
            {pending ? 'Awarding…' : 'Award badge'}
          </button>
        </div>
      </div>
    </div>
  );
}
