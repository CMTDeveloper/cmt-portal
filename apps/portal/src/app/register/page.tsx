'use client';

import { useState, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast, SetuLogo, SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, StepHeader } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';

// ─── Types ────────────────────────────────────────────────────────────────────

type LookupMatch = {
  fid: string;
  name: string;
  location: string;
  memberCount: number;
  managerInitials: string;
};

type LookupState = 'idle' | 'loading' | 'match' | 'nomatch';

// ─── Flag-off fallback (visual-only prototype) ────────────────────────────────

function RegisterPrototype() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const isMatch = email.toLowerCase() === 'raj.patel@gmail.com';
  const isNoMatch = email.trim() !== '' && phone.trim() !== '' && !isMatch;
  const state = isMatch ? 'match' : isNoMatch ? 'nomatch' : 'input';

  const formContent = (
    <>
      <StepHeader step={1} of={2} label="Your contact"/>
      <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 18, marginBottom: 8 }}>Let's find your family.</h1>
      <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 22, lineHeight: 1.5 }}>
        If someone in your household is already on Setu we'll connect you to them. Otherwise we'll start a new family record.
      </p>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Email address <span className="req">·</span></label>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/>
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <label>Phone number <span className="req">·</span></label>
        <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(416) 555-0000"/>
        <div className="hint">Canadian phone numbers only at this time.</div>
      </div>

      {state === 'match' && (
        <div style={{ padding: 16, border: '1px solid var(--line2)', background: 'var(--surface)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', color: 'var(--accentDeep)' }}>
              <SetuIcon.info/>
            </div>
            <strong style={{ fontSize: 14 }}>We found a family with this contact</strong>
          </div>
          <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)', marginBottom: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <SetuAvatar name="Patel Family" size={36}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>The Patel Family</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Brampton · 1 adult, 2 children · managed by A. Patel</div>
              </div>
            </div>
          </div>
          <Link href="/family" className="btn btn--p btn--block" style={{ marginBottom: 8, display: 'flex' }}>Join the Patel family →</Link>
          <button className="btn btn--g btn--block" style={{ fontSize: 13 }}>That's not me — contact admin</button>
        </div>
      )}

      {state === 'nomatch' && (
        <div style={{ padding: 14, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 'var(--radius)', marginBottom: 14, fontSize: 13, color: 'var(--body-text)' }}>
          No existing family matched — you'll be the start of a new one. Continue to step 2.
        </div>
      )}

      {state === 'input' && (
        <button className="btn btn--p btn--block">Continue →</button>
      )}
      {state === 'nomatch' && (
        <Link href="/register/family" className="btn btn--p btn--block" style={{ display: 'flex' }}>Continue to family details →</Link>
      )}

      <p style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        We use email + phone only to prevent duplicate family records. Your info isn't shared outside CMT.
      </p>
    </>
  );

  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', overflowY: 'auto' }}>
            <Link href="/sign-in" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, marginBottom: 12, color: 'var(--body-text)', display: 'inline-flex' }}>
              <SetuIcon.back/>
            </Link>
            {formContent}
          </div>
        </CspRoot>
      </div>
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <Link href="/sign-in" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
                <SetuIcon.back/> Back
              </Link>
              <SetuLogo size={22}/>
            </div>
            <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {formContent}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>
          <RightPane/>
        </CspRoot>
      </div>
    </>
  );
}

// ─── Right decorative pane (shared) ──────────────────────────────────────────

function RightPane() {
  return (
    <div style={{ flex: '1 1 0', background: 'var(--accent)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 48 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: .15, display: 'grid', placeItems: 'center' }}>
        <Rosette size={520} color="#fff" stroke={.5}/>
      </div>
      <div style={{ position: 'relative', color: '#fff' }}>
        <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Family registration</p>
        <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>
          "One Family ID per household keeps <em className="sa">Bala Vihar</em> enrollment, attendance, and donations all in one place."
        </p>
        <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>
          If someone in your household is already registered, we'll connect you automatically. No duplicates, no confusion.
        </p>
      </div>
    </div>
  );
}

// ─── Contact-verified banner (reads searchParams — must be inside Suspense) ───

function ContactVerifiedBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get('contact') !== 'verified') return null;
  return (
    <div style={{
      padding: '12px 16px',
      background: '#edfaf3',
      color: '#1a6b3c',
      border: '1px solid #6dd49a',
      borderRadius: 'var(--radiusSm)',
      marginBottom: 16,
      fontSize: 13,
      fontWeight: 600,
    }}>
      Your contact is verified. Complete your family details to finish.
    </div>
  );
}

// ─── Real register page ───────────────────────────────────────────────────────

function RegisterReal() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [lookupState, setLookupState] = useState<LookupState>('idle');
  const [match, setMatch] = useState<LookupMatch | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bothFilled = email.trim() !== '' && phone.trim() !== '';

  const runLookup = useCallback(async (emailVal: string, phoneVal: string) => {
    if (!emailVal.trim() || !phoneVal.trim()) return;
    setLookupState('loading');
    try {
      const res = await fetch('/api/setu/family-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailVal.trim(), phone: phoneVal.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? 'Lookup failed. Please try again.');
        setLookupState('idle');
        return;
      }
      const body = await res.json() as { match: LookupMatch | null };
      if (body.match) {
        setMatch(body.match);
        setLookupState('match');
      } else {
        setMatch(null);
        setLookupState('nomatch');
      }
    } catch {
      toast.error('Network error. Check your connection and try again.');
      setLookupState('idle');
    }
  }, []);

  function scheduleLookup(emailVal: string, phoneVal: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!emailVal.trim() || !phoneVal.trim()) {
      setLookupState('idle');
      setMatch(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runLookup(emailVal, phoneVal);
    }, 400);
  }

  function handleEmailChange(v: string) {
    setEmail(v);
    scheduleLookup(v, phone);
  }

  function handlePhoneChange(v: string) {
    setPhone(v);
    scheduleLookup(email, v);
  }

  function handleEmailBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (email.trim() && phone.trim()) void runLookup(email, phone);
  }

  function handlePhoneBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (email.trim() && phone.trim()) void runLookup(email, phone);
  }

  const isLoading = lookupState === 'loading';

  const familyLabel = match
    ? `The ${match.name} Family`
    : '';
  const familySubtitle = match
    ? `${match.location} · ${match.memberCount} member${match.memberCount !== 1 ? 's' : ''} · managed by ${match.managerInitials}`
    : '';

  const formContent = (
    <>
      <Suspense fallback={null}><ContactVerifiedBanner/></Suspense>
      <StepHeader step={1} of={2} label="Your contact"/>
      <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 18, marginBottom: 8 }}>Let's find your family.</h1>
      <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 22, lineHeight: 1.5 }}>
        If someone in your household is already on Setu we'll connect you to them. Otherwise we'll start a new family record.
      </p>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Email address <span className="req">·</span></label>
        <input
          className="input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => handleEmailChange(e.target.value)}
          onBlur={handleEmailBlur}
          autoComplete="email"
          disabled={isLoading}
        />
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <label>Phone number <span className="req">·</span></label>
        <input
          className="input"
          type="tel"
          placeholder="(416) 555-0000"
          value={phone}
          onChange={e => handlePhoneChange(e.target.value)}
          onBlur={handlePhoneBlur}
          autoComplete="tel"
          disabled={isLoading}
        />
        <div className="hint">Canadian phone numbers only at this time.</div>
      </div>

      {isLoading && (
        <div style={{ padding: 14, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 'var(--radius)', marginBottom: 14, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          Checking for existing families…
        </div>
      )}

      {lookupState === 'match' && match && (
        <div style={{ padding: 16, border: '1px solid var(--line2)', background: 'var(--surface)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', color: 'var(--accentDeep)' }}>
              <SetuIcon.info/>
            </div>
            <strong style={{ fontSize: 14 }}>We found a family with this contact</strong>
          </div>
          <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)', marginBottom: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <SetuAvatar name={familyLabel} size={36}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{familyLabel}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{familySubtitle}</div>
              </div>
            </div>
          </div>
          {/* SIGN-IN, NOT a direct join POST. The previous /api/setu/family/join
              endpoint accepted an unverified contactProof and was an account-
              takeover vector. OTP sign-in proves ownership of the contact,
              and verify-code resolves the existing family via contactKey →
              sets family-manager/member claims → /family. Same result, secure. */}
          <Link
            href={`/sign-in?email=${encodeURIComponent(email)}`}
            className="btn btn--p btn--block"
            style={{ marginBottom: 8, display: 'flex' }}
          >
            Sign in to join the {match.name} family →
          </Link>
          <a
            href="mailto:info@chinmayatoronto.org?subject=Setu%20account%20issue"
            className="btn btn--g btn--block"
            style={{ fontSize: 13, display: 'flex' }}
          >
            That&apos;s not me — contact admin
          </a>
        </div>
      )}

      {lookupState === 'nomatch' && (
        <div style={{ padding: 14, border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 'var(--radius)', marginBottom: 14, fontSize: 13, color: 'var(--body-text)' }}>
          No existing family matched — you'll be the start of a new one. Continue to step 2.
        </div>
      )}

      {lookupState === 'idle' && !isLoading && (
        <button
          className="btn btn--p btn--block"
          disabled={!bothFilled}
          onClick={() => { if (bothFilled) void runLookup(email, phone); }}
        >
          Continue →
        </button>
      )}
      {lookupState === 'nomatch' && (
        <Link
          href={`/register/family?email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`}
          className="btn btn--p btn--block"
          style={{ display: 'flex' }}
        >
          Continue to family details →
        </Link>
      )}

      <p style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        We use email + phone only to prevent duplicate family records. Your info isn't shared outside CMT.
      </p>
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', overflowY: 'auto' }}>
            <Link href="/sign-in" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, marginBottom: 12, color: 'var(--body-text)', display: 'inline-flex' }}>
              <SetuIcon.back/>
            </Link>
            {formContent}
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <Link href="/sign-in" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
                <SetuIcon.back/> Back
              </Link>
              <SetuLogo size={22}/>
            </div>
            <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {formContent}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>
          <RightPane/>
        </CspRoot>
      </div>
    </>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function RegisterPage() {
  if (!flags.setuAuth) {
    return <RegisterPrototype />;
  }
  return <RegisterReal />;
}
