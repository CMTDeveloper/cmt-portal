'use client';

import { Suspense, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast, SetuLogo, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { OtpEntry } from '@/features/family/components/otp-entry';
import { flags } from '@/lib/flags';

type ContactType = 'email' | 'phone';
type PageState = 'form' | 'code' | 'verifying';

// ─── Flag-off fallback (visual-only prototype) ────────────────────────────────
// @deprecated Never rendered in prod (flags.setuAuth is always true in production).

function SignInPrototype() {
  const [state, setState] = useState<'form' | 'sent'>('form');
  const [email, setEmail] = useState('');
  const displayEmail = email.trim() || 'your address';

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <Link href="/" className="focus-ring" style={{ background: 'transparent', border: 0, alignSelf: 'flex-start', padding: 6, marginLeft: -6, marginBottom: 20, color: 'var(--body-text)', display: 'inline-flex' }}>
              <SetuIcon.back/>
            </Link>
            <SetuLogo size={18}/>
            <div style={{ marginTop: 36 }}>
              {state === 'form' && (
                <>
                  <h1 style={{ fontSize: 30, fontWeight: 400, marginBottom: 10 }}>Sign in</h1>
                  <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 24, lineHeight: 1.5 }}>
                    We'll send you a 6-digit code. No password to remember.
                  </p>
                  <div className="field" style={{ marginBottom: 14 }}>
                    <label>Email address</label>
                    <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}/>
                  </div>
                  <button className="btn btn--p btn--block" style={{ marginBottom: 10 }} onClick={() => setState('sent')}>
                    Send sign-in code →
                  </button>
                  <button className="btn btn--g btn--block" style={{ fontSize: 13 }}>Use phone number instead</button>
                  <div style={{ marginTop: 24, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 12, color: 'var(--body-text)', lineHeight: 1.5 }}>
                    <strong>New to Setu?</strong> Use the same form — if we don't find an account we'll walk you through registering your family.
                  </div>
                </>
              )}
              {state === 'sent' && (
                <>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', marginBottom: 22 }}>
                    <SetuIcon.mail color="var(--accentDeep)"/>
                  </div>
                  <h1 style={{ fontSize: 28, fontWeight: 400, marginBottom: 10 }}>Check your inbox</h1>
                  <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6 }}>
                    We sent a 6-digit code to <strong>{displayEmail}</strong>. Enter it below to sign in.
                  </p>
                  <div style={{ marginTop: 28 }}>
                    <button className="btn btn--s btn--block" style={{ marginBottom: 8 }} onClick={() => setState('sent')}>Re-send code</button>
                    <button className="btn btn--g btn--block" onClick={() => setState('form')}>Use a different address</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
                <SetuIcon.back/> Back
              </Link>
              <SetuLogo size={22}/>
            </div>
            <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {state === 'form' && (
                <>
                  <h1 style={{ fontSize: 44, fontWeight: 400, marginBottom: 12, lineHeight: 1.08 }}>Sign in</h1>
                  <p style={{ fontSize: 15, color: 'var(--body-text)', marginBottom: 32, lineHeight: 1.6 }}>
                    We'll send you a 6-digit code. No password to remember.
                  </p>
                  <div className="field" style={{ marginBottom: 16 }}>
                    <label>Email address</label>
                    <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}/>
                  </div>
                  <button className="btn btn--p btn--block" style={{ marginBottom: 10, padding: '14px 22px' }} onClick={() => setState('sent')}>
                    Send sign-in code →
                  </button>
                  <button className="btn btn--g btn--block" style={{ fontSize: 13 }}>Use phone number instead</button>
                  <div style={{ marginTop: 28, padding: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5 }}>
                    <strong>New to Setu?</strong> Use the same form — if we don't find an account we'll walk you through registering your family.
                  </div>
                </>
              )}
              {state === 'sent' && (
                <>
                  <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', marginBottom: 28 }}>
                    <SetuIcon.mail color="var(--accentDeep)"/>
                  </div>
                  <h1 style={{ fontSize: 40, fontWeight: 400, marginBottom: 12, lineHeight: 1.1 }}>Check your inbox</h1>
                  <p style={{ fontSize: 15, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 32 }}>
                    We sent a 6-digit code to <strong>{displayEmail}</strong>. Enter it below to sign in.
                  </p>
                  <button className="btn btn--s btn--block" style={{ marginBottom: 10, padding: '14px' }} onClick={() => setState('sent')}>Re-send code</button>
                  <button className="btn btn--g btn--block" onClick={() => setState('form')}>Use a different address</button>
                </>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>
          <RightPane welcomeFlow={false}/>
        </CspRoot>
      </div>
    </>
  );
}

// ─── Right decorative pane (shared) ──────────────────────────────────────────

function RightPane({ welcomeFlow, adminFlow = false }: { welcomeFlow: boolean; adminFlow?: boolean }) {
  const label = adminFlow ? 'Admin access' : welcomeFlow ? 'Welcome team' : 'Member access';
  const quote = adminFlow
    ? '"Sign in to manage admins, welcome-team grants, reports, and family-roster operations across CMT."'
    : welcomeFlow
      ? '"For CMT volunteers helping families on Sunday — sign in to look up any family by name, FID, or contact."'
      : '"We\'ll send a one-time code to your email — no password to remember."';
  const footnote = adminFlow
    ? "Admin access is granted by an existing admin. Ask one to add your email if you don't see it."
    : welcomeFlow
      ? "Don't have welcome-team access? Ask the admin to grant your email."
      : "New to Setu? The same form handles registration — just enter your email and we'll guide you from there.";

  return (
    <div style={{ flex: '1 1 0', background: 'var(--accent)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 48 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: .15, display: 'grid', placeItems: 'center' }}>
        <Rosette size={520} color="#fff" stroke={.5}/>
      </div>
      <div style={{ position: 'relative', color: '#fff' }}>
        <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>{label}</p>
        <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>{quote}</p>
        <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>{footnote}</p>
      </div>
    </div>
  );
}

// ─── Real OTP flow ────────────────────────────────────────────────────────────

function SignInReal() {
  const searchParams = useSearchParams();
  const fromParam = searchParams?.get('from') ?? '';
  const welcomeFlow = fromParam.startsWith('/welcome');
  const adminFlow = fromParam === '/admin' || fromParam.startsWith('/admin/');
  const staffFlow = welcomeFlow || adminFlow;

  // /register dedupe sends the user here as /sign-in?email=foo when a
  // matching family is found, so we can pre-fill and skip a step.
  const prefillEmail = searchParams?.get('email') ?? '';

  const [pageState, setPageState] = useState<PageState>('form');
  const [contactType, setContactType] = useState<ContactType>('email');
  const [contactValue, setContactValue] = useState(prefillEmail);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const contactRef = useRef<HTMLInputElement>(null);

  const headline = adminFlow
    ? 'Admin sign-in'
    : welcomeFlow
      ? 'Welcome team sign-in'
      : 'Sign in';
  const subhead = adminFlow
    ? "We'll send a 6-digit code to the email your admin account is registered under."
    : welcomeFlow
      ? "We'll send a 6-digit code to the email your admin granted welcome-team access to."
      : "We'll send you a 6-digit code. No password to remember.";

  const contactLabel = contactType === 'email' ? 'Email address' : 'Phone number';
  const contactInputType = contactType === 'email' ? 'email' : 'tel';
  const contactPlaceholder = contactType === 'email' ? 'you@example.com' : '+1 (416) 555-0100';

  async function handleSendCode() {
    const trimmed = contactValue.trim();
    if (!trimmed) {
      toast.error(`Enter your ${contactLabel.toLowerCase()}`);
      contactRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/setu/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: contactType, value: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const reset = (body as { resetAt?: number }).resetAt;
          const msg = reset
            ? `Too many attempts. Try again after ${new Date(reset).toLocaleTimeString()}.`
            : 'Too many attempts. Please wait a minute and try again.';
          toast.error(msg);
          return;
        }
        toast.error((body as { error?: string }).error ?? 'Something went wrong. Please try again.');
        return;
      }
      setPageState('code');
      setOtp('');
    } catch {
      toast.error('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (otp.length < 6) {
      toast.error('Enter the full 6-digit code');
      return;
    }
    setPageState('verifying');
    try {
      const res = await fetch('/api/setu/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: contactType, value: contactValue.trim(), code: otp }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = res.status === 410
          ? 'That code has expired. Request a new one.'
          : (body as { error?: string }).error ?? 'Incorrect code. Please try again.';
        toast.error(msg);
        setPageState('code');
        setOtp('');
        return;
      }
      const { redirectTo } = (await res.json()) as { redirectTo?: string };
      // Honor ?from= when it's a safe internal path (e.g. /invite/{token}).
      // This lets users land back on the page that bounced them to sign-in.
      const fromParam = new URLSearchParams(window.location.search).get('from');
      const fromIsSafe =
        fromParam !== null &&
        fromParam.startsWith('/') &&
        !fromParam.startsWith('//') &&
        !fromParam.includes('://');
      window.location.href = fromIsSafe ? fromParam : (redirectTo ?? '/family');
    } catch {
      toast.error('Network error. Check your connection and try again.');
      setPageState('code');
    }
  }

  async function handleResend() {
    setOtp('');
    // Call send-code with current contactValue; on success handleSendCode sets 'code' state.
    // We don't pre-set 'form' so the user stays on the code screen if the resend fails.
    await handleSendCode();
  }

  const isVerifying = pageState === 'verifying';

  // ── Mobile ──────────────────────────────────────────────────────────────────
  const mobileContent = (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <Link href="/" className="focus-ring" style={{ background: 'transparent', border: 0, alignSelf: 'flex-start', padding: 6, marginLeft: -6, marginBottom: 20, color: 'var(--body-text)', display: 'inline-flex' }}>
          <SetuIcon.back/>
        </Link>
        <SetuLogo size={18}/>
        <div style={{ marginTop: 36 }}>
          {pageState === 'form' && (
            <>
              <h1 style={{ fontSize: 30, fontWeight: 400, marginBottom: 10 }}>{headline}</h1>
              <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 24, lineHeight: 1.5 }}>
                {subhead}
              </p>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>{contactLabel}</label>
                <input
                  ref={contactRef}
                  className="input"
                  type={contactInputType}
                  placeholder={contactPlaceholder}
                  value={contactValue}
                  onChange={(e) => setContactValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                  autoComplete={contactType === 'email' ? 'email' : 'tel'}
                  disabled={loading}
                />
              </div>
              <button
                className="btn btn--p btn--block"
                style={{ marginBottom: 10 }}
                onClick={handleSendCode}
                disabled={loading}
              >
                {loading ? 'Sending…' : 'Send sign-in code →'}
              </button>
              <button
                className="btn btn--g btn--block"
                style={{ fontSize: 13 }}
                onClick={() => {
                  setContactType(contactType === 'email' ? 'phone' : 'email');
                  setContactValue('');
                }}
                disabled={loading}
              >
                {contactType === 'email' ? 'Use phone number instead' : 'Use email instead'}
              </button>
              {!staffFlow && (
                <>
                  <div style={{ marginTop: 24, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 12, color: 'var(--body-text)', lineHeight: 1.5 }}>
                    <strong>New to Setu?</strong> Use the same form — if we don't find an account we'll walk you through registering your family.
                  </div>
                  <Link href="/register" className="btn btn--g btn--block" style={{ marginTop: 10, fontSize: 13, display: 'flex' }}>Register your family →</Link>
                </>
              )}
            </>
          )}
          {(pageState === 'code' || pageState === 'verifying') && (
            <>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', marginBottom: 22 }}>
                <SetuIcon.mail color="var(--accentDeep)"/>
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 400, marginBottom: 10 }}>Enter your code</h1>
              <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 24 }}>
                We sent a 6-digit code to <strong>{contactValue.trim()}</strong>. Enter it below.
              </p>
              <div style={{ marginBottom: 20 }}>
                <OtpEntry value={otp} onChange={setOtp} disabled={isVerifying} />
              </div>
              <button
                className="btn btn--p btn--block"
                style={{ marginBottom: 8 }}
                onClick={handleVerifyCode}
                disabled={isVerifying || otp.length < 6}
              >
                {isVerifying ? 'Verifying…' : 'Verify code →'}
              </button>
              <button className="btn btn--s btn--block" style={{ marginBottom: 8 }} onClick={handleResend} disabled={isVerifying}>
                Re-send code
              </button>
              <button className="btn btn--g btn--block" onClick={() => { setPageState('form'); setOtp(''); }} disabled={isVerifying}>
                Use a different address
              </button>
              <p style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Didn&apos;t get a code? Make sure your email is registered or{' '}
                <Link href="/register" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>register a new family →</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </CspRoot>
  );

  // ── Desktop ─────────────────────────────────────────────────────────────────
  const desktopContent = (
    <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
      <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 'auto' }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
            <SetuIcon.back/> Back
          </Link>
          <SetuLogo size={22}/>
        </div>

        <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
          {pageState === 'form' && (
            <>
              <h1 style={{ fontSize: 44, fontWeight: 400, marginBottom: 12, lineHeight: 1.08 }}>{headline}</h1>
              <p style={{ fontSize: 15, color: 'var(--body-text)', marginBottom: 32, lineHeight: 1.6 }}>
                {subhead}
              </p>
              <div className="field" style={{ marginBottom: 16 }}>
                <label>{contactLabel}</label>
                <input
                  ref={contactRef}
                  className="input"
                  type={contactInputType}
                  placeholder={contactPlaceholder}
                  value={contactValue}
                  onChange={(e) => setContactValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                  autoComplete={contactType === 'email' ? 'email' : 'tel'}
                  disabled={loading}
                />
              </div>
              <button
                className="btn btn--p btn--block"
                style={{ marginBottom: 10, padding: '14px 22px' }}
                onClick={handleSendCode}
                disabled={loading}
              >
                {loading ? 'Sending…' : 'Send sign-in code →'}
              </button>
              <button
                className="btn btn--g btn--block"
                style={{ fontSize: 13 }}
                onClick={() => {
                  setContactType(contactType === 'email' ? 'phone' : 'email');
                  setContactValue('');
                }}
                disabled={loading}
              >
                {contactType === 'email' ? 'Use phone number instead' : 'Use email instead'}
              </button>
              {!staffFlow && (
                <>
                  <div style={{ marginTop: 28, padding: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5 }}>
                    <strong>New to Setu?</strong> Use the same form — if we don't find an account we'll walk you through registering your family.
                  </div>
                  <Link href="/register" className="btn btn--g btn--block" style={{ marginTop: 10, fontSize: 13, display: 'flex' }}>Register your family →</Link>
                </>
              )}
            </>
          )}
          {(pageState === 'code' || pageState === 'verifying') && (
            <>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', marginBottom: 28 }}>
                <SetuIcon.mail color="var(--accentDeep)"/>
              </div>
              <h1 style={{ fontSize: 40, fontWeight: 400, marginBottom: 12, lineHeight: 1.1 }}>Enter your code</h1>
              <p style={{ fontSize: 15, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 32 }}>
                We sent a 6-digit code to <strong>{contactValue.trim()}</strong>. Enter it below to continue.
              </p>
              <div style={{ marginBottom: 24 }}>
                <OtpEntry value={otp} onChange={setOtp} disabled={isVerifying} />
              </div>
              <button
                className="btn btn--p btn--block"
                style={{ marginBottom: 10, padding: '14px 22px' }}
                onClick={handleVerifyCode}
                disabled={isVerifying || otp.length < 6}
              >
                {isVerifying ? 'Verifying…' : 'Verify code →'}
              </button>
              <button className="btn btn--s btn--block" style={{ marginBottom: 10, padding: '14px' }} onClick={handleResend} disabled={isVerifying}>
                Re-send code
              </button>
              <button className="btn btn--g btn--block" onClick={() => { setPageState('form'); setOtp(''); }} disabled={isVerifying}>
                Use a different address
              </button>
              <p style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                Didn&apos;t get a code? Make sure your email is registered or{' '}
                <Link href="/register" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>register a new family →</Link>
              </p>
            </>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
          <span>setu.chinmayatoronto.org</span>
          <span>·</span>
          <span>© 2026 CMT</span>
        </div>
      </div>
      <RightPane welcomeFlow={welcomeFlow} adminFlow={adminFlow}/>
    </CspRoot>
  );

  return (
    <>
      <div className="block md:hidden">{mobileContent}</div>
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>{desktopContent}</div>
    </>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function SignInPage() {
  if (!flags.setuAuth) {
    return <SignInPrototype />;
  }
  // SignInReal uses useSearchParams() — Next 16 requires it inside Suspense
  // (CSR-bailout during prerender of the dynamic ?from= query).
  return (
    <Suspense fallback={null}>
      <SignInReal />
    </Suspense>
  );
}
