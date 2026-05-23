'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, StepHeader } from '@/features/family/components/atoms';

export default function RegisterPage() {
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
          {/* Left pane — form */}
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

          {/* Right pane — decorative */}
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
        </CspRoot>
      </div>
    </>
  );
}
