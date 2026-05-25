'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from '@cmt/ui';

export function ThemedAddWelcomeTeamForm() {
  const [email, setEmail] = useState('');
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Enter an email');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/admin/welcome-team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Grant failed');
        return;
      }
      toast.success(`Granted welcome-team to ${trimmed}.`);
      setEmail('');
      // Soft refresh of the list — easiest is a window reload after the toast.
      setTimeout(() => window.location.reload(), 800);
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Volunteer email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="volunteer@example.com"
          disabled={pending}
          required
        />
      </div>
      <button type="submit" className="btn btn--p btn--block" disabled={pending}>
        {pending ? 'Granting…' : 'Grant welcome-team →'}
      </button>
      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
        The volunteer signs in at <code>/sign-in</code> with this email via OTP — no password.
        They'll land on <code>/welcome</code> with read access to every family.
      </p>
    </form>
  );
}
