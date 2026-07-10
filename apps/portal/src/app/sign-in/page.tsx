'use client';

import { Suspense, useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast, SetuLogo, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { OtpEntry } from '@/features/family/components/otp-entry';
import { sendJoinRequestClient } from '@/features/setu/join-request';
import { flags } from '@/lib/flags';

type ContactType = 'email' | 'phone';
type PageState = 'form' | 'code' | 'verifying' | 'pending-approval';
type SignInMode = 'otp' | 'password';

const MODE_STORAGE_KEY = 'setu-signin-mode';

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
                    <strong>New to Chinmaya Setu?</strong> Use the same form - if we don't find an account we'll walk you through registering your family.
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
                    <strong>New to Chinmaya Setu?</strong> Use the same form - if we don't find an account we'll walk you through registering your family.
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
      : "New to Chinmaya Setu? The same form handles registration - just enter your email and we'll guide you from there.";

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

// ─── Real OTP + Password flow ─────────────────────────────────────────────────

function SignInReal() {
  const searchParams = useSearchParams();
  const fromParam = searchParams?.get('from') ?? '';
  const welcomeFlow = fromParam.startsWith('/welcome');
  const adminFlow = fromParam === '/admin' || fromParam.startsWith('/admin/');
  const sevakFlow = welcomeFlow || adminFlow;

  const prefillType = searchParams?.get('type');
  const prefillValue = searchParams?.get('value');
  const prefillEmail = searchParams?.get('email') ?? '';
  const initialContactType: ContactType = prefillType === 'phone' ? 'phone' : 'email';
  const initialContactValue = prefillValue ?? prefillEmail;
  // A register "We found a family" CTA hands off via ?type=&value= to drive an
  // OTP proof. When present we must NOT restore a saved password-mode preference:
  // password mode is email-only and would drop the prefilled phone/email + intent.
  const hasOtpHandoff = Boolean(prefillType || prefillValue);

  // Read localStorage preference once on mount; default to 'otp'.
  const [signInMode, setSignInMode] = useState<SignInMode>('otp');
  useEffect(() => {
    if (hasOtpHandoff) return; // a register OTP-proof handoff forces code mode
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === 'password') setSignInMode('password');
    } catch {
      // localStorage unavailable (private browsing, SSR) — stay 'otp'
    }
  }, [hasOtpHandoff]);

  function switchMode(next: SignInMode, prefill?: string) {
    setSignInMode(next);
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* ignore */ }
    if (prefill !== undefined) setContactValue(prefill);
    // Reset OTP state when switching modes
    setPageState('form');
    setOtp('');
    setPwError('');
  }

  const [pageState, setPageState] = useState<PageState>('form');
  const [contactType, setContactType] = useState<ContactType>(initialContactType);
  const [contactValue, setContactValue] = useState(initialContactValue);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const contactRef = useRef<HTMLInputElement>(null);

  // Pending-approval state: set when verify-code resolves a gated member
  // (portalAccess:'pending') — no session is minted; the user must wait for a
  // family manager to approve. We offer to (re)send the join request from here.
  const [resending, setResending] = useState(false);
  const [requestResent, setRequestResent] = useState(false);

  // Password mode state
  const [pwEmail, setPwEmail] = useState(initialContactType === 'email' ? initialContactValue : '');
  const [pwPassword, setPwPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const pwEmailRef = useRef<HTMLInputElement>(null);

  const headline = adminFlow
    ? 'Admin sign-in'
    : welcomeFlow
      ? 'Welcome team sign-in'
      : 'Sign in';
  const otpSubhead = adminFlow
    ? "We'll send a 6-digit code to the email your admin account is registered under."
    : welcomeFlow
      ? "We'll send a 6-digit code to the email your admin granted welcome-team access to."
      : "We'll send you a 6-digit code. No password to remember.";

  const contactLabel = contactType === 'email' ? 'Email address' : 'Phone number';
  const contactInputType = contactType === 'email' ? 'email' : 'tel';
  const contactPlaceholder = contactType === 'email' ? 'you@example.com' : '(416) 555-0100 or +14165550100';
  const contactHint = contactType === 'phone'
    ? "Canadian / US numbers — we'll add +1 automatically if you don't type it."
    : null;

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
      const body = (await res.json()) as { redirectTo?: string; pendingApproval?: boolean };
      // Gated member: the code was correct (contact ownership proven) but the
      // member's portal access is pending a family manager's approval, so no
      // session was minted. Show the pending state instead of redirecting.
      if (body.pendingApproval) {
        setRequestResent(false);
        setPageState('pending-approval');
        return;
      }
      const { redirectTo } = body;
      const fromQ = new URLSearchParams(window.location.search).get('from');
      const fromIsSafe =
        fromQ !== null &&
        fromQ.startsWith('/') &&
        !fromQ.startsWith('//') &&
        !fromQ.includes('://');
      window.location.href = fromIsSafe ? fromQ : (redirectTo ?? '/family');
    } catch {
      toast.error('Network error. Check your connection and try again.');
      setPageState('code');
    }
  }

  // (Re)send the join request to the family manager from the pending-approval
  // screen. The send endpoint is anti-enumeration + idempotent, so a repeat just
  // refreshes the open request. We send the contact the user just verified.
  async function handleResendJoinRequest() {
    const trimmed = contactValue.trim();
    if (!trimmed) return;
    setResending(true);
    const contact = contactType === 'email' ? { email: trimmed } : { phone: trimmed };
    const result = await sendJoinRequestClient(contact);
    if (result.ok) {
      setRequestResent(true);
    } else if (result.error === 'rate-limited') {
      toast.error('Too many requests. Please wait a minute and try again.');
    } else if (result.error === 'network') {
      toast.error('Network error. Check your connection and try again.');
    } else {
      toast.error('Could not send your request. Please try again.');
    }
    setResending(false);
  }

  async function handleResend() {
    setOtp('');
    await handleSendCode();
  }

  async function handlePasswordSignIn() {
    const email = pwEmail.trim();
    const password = pwPassword;
    if (!email) {
      setPwError('Enter your email address.');
      pwEmailRef.current?.focus();
      return;
    }
    if (!password) {
      setPwError('Enter your password.');
      return;
    }
    setPwError('');
    setPwLoading(true);
    try {
      const res = await fetch('/api/setu/auth/password-sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          toast.error('Incorrect email or password.');
        } else if (res.status === 403) {
          toast.error('Your account has been disabled. Contact your family manager.');
        } else if (res.status === 429) {
          toast.error('Too many attempts. Please wait a minute and try again.');
        } else {
          toast.error('Something went wrong. Please try again.');
        }
        return;
      }
      const body = (await res.json()) as { redirectTo?: string; pendingApproval?: boolean };
      // Gated member: valid password, but portal access is pending a family
      // manager's approval — no session was minted. Show the pending state (the
      // gate holds on the password path too); do not fall through to /family.
      if (body.pendingApproval) {
        setRequestResent(false);
        setPageState('pending-approval');
        return;
      }
      const fromQ = new URLSearchParams(window.location.search).get('from');
      const fromIsSafe =
        fromQ !== null &&
        fromQ.startsWith('/') &&
        !fromQ.startsWith('//') &&
        !fromQ.includes('://');
      window.location.assign(fromIsSafe ? fromQ : (body.redirectTo ?? '/family'));
    } catch {
      toast.error('Network error. Check your connection and try again.');
    } finally {
      setPwLoading(false);
    }
  }

  const isVerifying = pageState === 'verifying';

  // ── Mode toggle (rendered above the contact field) ───────────────────────────
  const modeToggle = !sevakFlow ? (
    <div style={{ marginBottom: 18 }}>
      {signInMode === 'otp' ? (
        <button
          className="btn btn--g"
          style={{ fontSize: 13 }}
          onClick={() => switchMode('password', contactType === 'email' ? contactValue : '')}
          type="button"
        >
          Have a password? Sign in faster →
        </button>
      ) : (
        <button
          className="btn btn--g"
          style={{ fontSize: 13 }}
          onClick={() => { switchMode('otp'); }}
          type="button"
        >
          Or sign in with a code →
        </button>
      )}
    </div>
  ) : null;

  // ── Password form (shared between mobile / desktop, caller controls sizing) ─
  // IMPORTANT: declared as a render helper (called as renderPasswordForm(...)),
  // NOT a nested function component used as <PasswordForm ... />. Nested-function
  // components are recreated on every parent render → React sees a new component
  // identity → the input gets unmounted/remounted → focus is lost between keystrokes.
  // Calling as a function inlines the JSX so the input stays mounted across renders.
  function renderPasswordForm(compact: boolean) {
    const mb = compact ? 14 : 16;
    const btnPad = compact ? undefined : '14px 22px';
    return (
      <>
        <h1 style={{ fontSize: compact ? 30 : 44, fontWeight: 400, marginBottom: compact ? 10 : 12, lineHeight: compact ? undefined : 1.08 }}>{headline}</h1>
        <p style={{ fontSize: compact ? 14 : 15, color: 'var(--body-text)', marginBottom: compact ? 20 : 28, lineHeight: 1.5 }}>
          Sign in with your email and password.
        </p>
        {modeToggle}
        {pwError && (
          <p style={{ fontSize: 13, color: 'var(--danger, #c0392b)', marginBottom: 10 }}>{pwError}</p>
        )}
        <div className="field" style={{ marginBottom: mb }}>
          <label>Email address</label>
          <input
            ref={pwEmailRef}
            className="input"
            type="email"
            placeholder="you@example.com"
            value={pwEmail}
            onChange={(e) => setPwEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSignIn()}
            autoComplete="email"
            disabled={pwLoading}
          />
        </div>
        <div className="field" style={{ marginBottom: 6 }}>
          <label>Password</label>
          <input
            className="input"
            type="password"
            placeholder="Your password"
            value={pwPassword}
            onChange={(e) => setPwPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSignIn()}
            autoComplete="current-password"
            disabled={pwLoading}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: mb }}>
          <button
            type="button"
            onClick={() => {
              switchMode('otp', pwEmail);
              // Carry the reset-password intent through the OTP flow. The
              // verify-code redirect logic reads ?from= from window.location.search
              // (lines 284-290) and lands the user at the target after sign-in.
              if (typeof window !== 'undefined') {
                const url = new URL(window.location.href);
                url.searchParams.set('from', '/family/settings/security');
                window.history.replaceState({}, '', url.toString());
              }
              toast.info('Sign in with a code below — we’ll take you to set a new password.');
            }}
            disabled={pwLoading}
            style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              fontSize: 12, color: 'var(--accentDeep)', textDecoration: 'underline',
              fontFamily: 'var(--body)',
            }}
          >
            Forgot password?
          </button>
        </div>
        <button
          className="btn btn--p btn--block"
          style={{ marginBottom: 10, ...(btnPad ? { padding: btnPad } : {}) }}
          onClick={handlePasswordSignIn}
          disabled={pwLoading}
          type="button"
        >
          {pwLoading ? 'Signing in…' : 'Sign in →'}
        </button>
        {!sevakFlow && (
          <>
            <div style={{ marginTop: 24, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 12, color: 'var(--body-text)', lineHeight: 1.5 }}>
              <strong>New to Chinmaya Setu?</strong> Register your family to create your account.
            </div>
            <Link href="/register" className="btn btn--g btn--block" style={{ marginTop: 10, fontSize: 13, display: 'flex' }}>Register your family →</Link>
          </>
        )}
      </>
    );
  }

  // ── Pending-approval screen (shared mobile / desktop) ────────────────────────
  // Declared as a render helper (called inline), NOT a nested component, to keep
  // any focusable children mounted across renders (see renderPasswordForm note).
  function renderPendingApproval(compact: boolean) {
    return (
      <>
        <div style={{ width: compact ? 64 : 72, height: compact ? 64 : 72, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', marginBottom: compact ? 22 : 28 }}>
          <SetuIcon.mail color="var(--accentDeep)"/>
        </div>
        <h1 style={{ fontSize: compact ? 28 : 40, fontWeight: 400, marginBottom: compact ? 10 : 12, lineHeight: compact ? undefined : 1.1 }}>
          Almost there
        </h1>
        <p style={{ fontSize: compact ? 14 : 15, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: compact ? 24 : 32 }}>
          Your access is pending your family manager&apos;s approval. We&apos;ve let them know — once
          they approve, sign in again with <strong>{contactValue.trim()}</strong> to access your family.
        </p>
        {requestResent ? (
          <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 13, color: 'var(--body-text)', marginBottom: 12 }} role="status">
            Request sent. Your manager will review it shortly.
          </div>
        ) : (
          <button
            className="btn btn--p btn--block"
            style={{ marginBottom: 10, ...(compact ? {} : { padding: '14px 22px' }) }}
            onClick={handleResendJoinRequest}
            disabled={resending}
            type="button"
          >
            {resending ? 'Sending…' : 'Re-send request to my manager →'}
          </button>
        )}
        <button
          className="btn btn--g btn--block"
          style={{ fontSize: 13 }}
          onClick={() => { setPageState('form'); setOtp(''); }}
          disabled={resending}
          type="button"
        >
          Use a different address
        </button>
      </>
    );
  }

  // ── Mobile ──────────────────────────────────────────────────────────────────
  const mobileContent = (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <Link href="/" className="focus-ring" style={{ background: 'transparent', border: 0, alignSelf: 'flex-start', padding: 6, marginLeft: -6, marginBottom: 20, color: 'var(--body-text)', display: 'inline-flex' }}>
          <SetuIcon.back/>
        </Link>
        <SetuLogo size={18}/>
        <div style={{ marginTop: 36 }}>
          {signInMode === 'password' ? (
            renderPasswordForm(true)
          ) : (
            <>
              {pageState === 'form' && (
                <>
                  <h1 style={{ fontSize: 30, fontWeight: 400, marginBottom: 10 }}>{headline}</h1>
                  <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 24, lineHeight: 1.5 }}>
                    {otpSubhead}
                  </p>
                  {modeToggle}
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
                    {contactHint && (
                      <p style={{ fontSize: 12, color: 'var(--muted-text)', marginTop: 6, lineHeight: 1.4 }}>{contactHint}</p>
                    )}
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
                  {!sevakFlow && (
                    <>
                      <div style={{ marginTop: 24, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 12, color: 'var(--body-text)', lineHeight: 1.5 }}>
                        <strong>New to Chinmaya Setu?</strong> Use the same form - if we don't find an account we'll walk you through registering your family.
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
                  {!sevakFlow && (
                    <div style={{ marginTop: 18, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)' }}>
                      <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Didn&apos;t get a code?</p>
                      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
                        Codes only go to emails that already belong to a family on Chinmaya Setu. If this is your first time, register your family below.
                      </p>
                      <Link href="/register" className="btn btn--s btn--block" style={{ display: 'flex', fontSize: 13 }}>
                        Register a new family →
                      </Link>
                    </div>
                  )}
                </>
              )}
              {pageState === 'pending-approval' && renderPendingApproval(true)}
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
          {signInMode === 'password' ? (
            renderPasswordForm(false)
          ) : (
            <>
              {pageState === 'form' && (
                <>
                  <h1 style={{ fontSize: 44, fontWeight: 400, marginBottom: 12, lineHeight: 1.08 }}>{headline}</h1>
                  <p style={{ fontSize: 15, color: 'var(--body-text)', marginBottom: 32, lineHeight: 1.6 }}>
                    {otpSubhead}
                  </p>
                  {modeToggle}
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
                    {contactHint && (
                      <p style={{ fontSize: 12, color: 'var(--muted-text)', marginTop: 6, lineHeight: 1.4 }}>{contactHint}</p>
                    )}
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
                  {!sevakFlow && (
                    <>
                      <div style={{ marginTop: 28, padding: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5 }}>
                        <strong>New to Chinmaya Setu?</strong> Use the same form - if we don't find an account we'll walk you through registering your family.
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
                  {!sevakFlow && (
                    <div style={{ marginTop: 20, padding: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Didn&apos;t get a code?</p>
                      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 12 }}>
                        Codes only go to emails that already belong to a family on Chinmaya Setu. If this is your first time, register your family below.
                      </p>
                      <Link href="/register" className="btn btn--s btn--block" style={{ display: 'flex' }}>
                        Register a new family →
                      </Link>
                    </div>
                  )}
                </>
              )}
              {pageState === 'pending-approval' && renderPendingApproval(false)}
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
