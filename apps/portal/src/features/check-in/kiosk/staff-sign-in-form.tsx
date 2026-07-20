'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SetuLogo } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';

// Staff sign-in for the check-in kiosk (a shared door tablet). Username + password
// against POST /api/setu/auth/kiosk-sign-in - the sevak team has no session yet.
// HARD-navigates on success so the middleware gate re-runs server-side on the
// fresh __session cookie (a soft router.push would read a stale server render).
export function StaffSignInForm() {
  const searchParams = useSearchParams();

  const rawFrom = searchParams?.get('from');
  const isSafe = !!rawFrom && rawFrom.startsWith('/') && !rawFrom.startsWith('//') && !rawFrom.includes('://');
  const from = isSafe ? rawFrom : null;

  const errorParam = searchParams?.get('error');
  const banner =
    errorParam === 'session-expired'
      ? 'Your session expired. Please sign in again.'
      : errorParam === 'unauthorized'
        ? 'Please sign in to use the kiosk.'
        : null;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleSignIn() {
    setError('');
    setPending(true);
    try {
      const url = from
        ? '/api/setu/auth/kiosk-sign-in?from=' + encodeURIComponent(from)
        : '/api/setu/auth/kiosk-sign-in';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError('Wrong username or password.');
        } else if (res.status === 429) {
          setError('Too many attempts. Please wait a minute and try again.');
        } else if (res.status === 400) {
          setError('Enter your username and password.');
        } else {
          setError('Something went wrong. Please try again.');
        }
        return;
      }
      const body = (await res.json()) as { redirectTo?: string };
      window.location.assign(body.redirectTo ?? '/check-in');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 460 }}>
          <div style={{ marginBottom: 28 }}>
            <SetuLogo size={22} />
          </div>

          {banner && (
            <div
              role="status"
              style={{
                marginBottom: 24,
                padding: '16px 18px',
                background: 'var(--accentSoft)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radiusSm)',
                fontSize: 15,
                color: 'var(--body-text)',
                lineHeight: 1.5,
              }}
            >
              {banner}
            </div>
          )}

          <h1 style={{ fontSize: 36, fontWeight: 400, marginBottom: 10, lineHeight: 1.1 }}>Staff sign-in</h1>
          <p style={{ fontSize: 15, color: 'var(--body-text)', marginBottom: 28, lineHeight: 1.5 }}>
            Sign in to run the check-in kiosk.
          </p>

          {error && (
            <p
              role="alert"
              style={{
                fontSize: 15,
                color: 'var(--danger, #c0392b)',
                marginBottom: 16,
              }}
            >
              {error}
            </p>
          )}

          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="staff-username">Username</label>
            <input
              id="staff-username"
              className="input"
              type="text"
              placeholder="sevak"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              autoComplete="username"
              disabled={pending}
              style={{ padding: '16px 16px', fontSize: 17 }}
            />
          </div>

          <div className="field" style={{ marginBottom: 24 }}>
            <label htmlFor="staff-password">Password</label>
            <input
              id="staff-password"
              className="input"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              autoComplete="current-password"
              disabled={pending}
              style={{ padding: '16px 16px', fontSize: 17 }}
            />
          </div>

          <button
            className="btn btn--p btn--block"
            style={{ padding: '16px 22px', fontSize: 16 }}
            onClick={handleSignIn}
            disabled={pending}
            type="button"
          >
            {pending ? 'Signing in…' : 'Sign in →'}
          </button>
        </div>
      </div>
    </CspRoot>
  );
}
