'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';

export default function SecuritySettingsPage() {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [showForm, setShowForm] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch('/api/setu/auth/set-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setPasswordSet(true);
        setShowForm(false);
        setPassword('');
        toast.success('Password saved. You can now sign in with email + password.');
        return;
      }

      const json = await res.json().catch(() => ({})) as { error?: string };
      toast.error(json.error ?? 'Save failed');
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  const formSection = (
    <div>
      <SectionLabel>Set a password (optional)</SectionLabel>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Lets you sign in without an OTP next time.
      </p>

      {passwordSet && !showForm ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', marginBottom: 14 }}>
            <SetuIcon.shield/>
            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>Password is set</span>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              Change password
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Next time you sign in, use email + password from the sign-in screen — no OTP needed.
          </p>
          <Link
            href="/family"
            className="btn btn--p"
            style={{ padding: '12px 24px', display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
          >
            Done · Back to family →
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>New password <span className="req">·</span></label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
              required
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
            At least 8 characters with letters and numbers.
          </p>
          <button
            type="submit"
            className="btn btn--p"
            style={{ padding: '12px 24px' }}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save password'}
          </button>
          {passwordSet && (
            <button
              type="button"
              onClick={() => { setShowForm(false); }}
              className="btn btn--g"
              style={{ marginLeft: 10 }}
            >
              Cancel
            </button>
          )}
        </form>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Sign-in security</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 100px' }}>
              {formSection}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Settings</p>
            <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>Sign-in security</h1>
          </div>
        </header>

        <div style={{ maxWidth: 520 }}>
          {formSection}
        </div>
      </div>
    </>
  );
}
