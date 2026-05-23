'use client';

import { useState } from 'react';
import { SetuIcon, toast } from '@cmt/ui';

const RELATION_OPTIONS = ['Spouse', 'Parent', 'Sibling', 'Adult child', 'Other'] as const;
type Relation = (typeof RELATION_OPTIONS)[number];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InviteModal({ open, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [relation, setRelation] = useState<Relation>('Spouse');
  const [sending, setSending] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Enter an email address');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/setu/invite/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: trimmed, relation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string })?.error ?? 'Could not send invite. Try again.');
        return;
      }
      toast.success('Invite sent!');
      setEmail('');
      setRelation('Spouse');
      onClose();
    } catch {
      toast.error('Network error. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite a co-manager"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--line)',
        padding: '28px 24px',
        width: '100%', maxWidth: 440,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        <div className="between" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Invite a co-manager</h2>
          <button
            className="focus-ring"
            onClick={onClose}
            style={{ background: 'transparent', border: 0, padding: 4, color: 'var(--muted)', display: 'inline-flex' }}
            aria-label="Close"
          >
            <SetuIcon.x />
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, marginBottom: 22 }}>
          A co-manager can enroll children, record attendance, and manage donations for your family.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="invite-email">Email address</label>
            <input
              id="invite-email"
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={sending}
              required
            />
          </div>

          <div className="field" style={{ marginBottom: 22 }}>
            <label htmlFor="invite-relation">Relation</label>
            <select
              id="invite-relation"
              className="input"
              value={relation}
              onChange={(e) => setRelation(e.target.value as Relation)}
              disabled={sending}
            >
              {RELATION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="btn btn--p btn--block"
            disabled={sending}
          >
            {sending ? 'Sending…' : 'Send invite →'}
          </button>
          <button
            type="button"
            className="btn btn--g btn--block"
            style={{ marginTop: 8, fontSize: 13 }}
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
