'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot, SectionLabel, DesktopSidebar } from '@/features/family/components/atoms';

export default function AddMemberPage() {
  const [mode, setMode] = useState<'child' | 'adult'>('child');

  const formBody = (
    <>
      <div className="field" style={{ marginBottom: 16 }}>
        <label>Member type <span className="req">·</span></label>
        <div className="row" style={{ gap: 8 }}>
          {(['Adult', 'Child'] as const).map((m) => {
            const active = m.toLowerCase() === mode;
            return (
              <button key={m} onClick={() => setMode(m.toLowerCase() as 'adult' | 'child')} style={{
                flex: 1, padding: '12px',
                border: '1px solid', borderColor: active ? 'var(--accent)' : 'var(--line2)',
                background: active ? 'var(--accentSoft)' : 'var(--surface)',
                color: active ? 'var(--accentDeep)' : 'var(--body-text)',
                fontWeight: 600, fontSize: 14, borderRadius: 'var(--radiusSm)',
              }}>{m}</button>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>First name <span className="req">·</span></label>
          <input className="input" defaultValue={mode === 'child' ? 'Arjun' : ''}/>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Last name <span className="req">·</span></label>
          <input className="input" defaultValue="Patel"/>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Gender <span className="req">·</span></label>
        <select className="input" defaultValue={mode === 'child' ? 'm' : 'f'}>
          <option value="m">Male</option>
          <option value="f">Female</option>
          <option value="x">Prefer not to say</option>
        </select>
      </div>

      {mode === 'child' && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>School grade</label>
              <select className="input" defaultValue="1">
                <option>Pre-K</option>
                <option>K</option>
                <option>1</option>
                <option>2</option>
                <option>3</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Birth month/year</label>
              <input className="input" defaultValue="Aug 2019"/>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>Food allergies <span className="req">·</span></label>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              {['None', 'Peanuts', 'Dairy', 'Other…'].map((a, i) => (
                <button key={i} className="pill" style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--line2)', fontSize: 12 }}>{a}</button>
              ))}
            </div>
            <textarea className="input" rows={2} defaultValue="None" style={{ fontFamily: 'inherit' }}/>
          </div>
        </>
      )}

      <SectionLabel>Emergency contact 1 <span className="req">·</span></SectionLabel>
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Relation</label>
          <input className="input" defaultValue="Mother"/>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Phone</label>
          <input className="input" defaultValue="(416) 555-3387"/>
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" defaultValue="aarti.patel@gmail.com"/>
        </div>
      </div>

      <button className="focus-ring" style={{ marginTop: 10, padding: '10px 4px', background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
        + Add emergency contact 2
      </button>
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.x/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Add member</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 100px' }}>
              {formBody}
            </div>
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              <button className="btn btn--p btn--block">Add member</button>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="family"/>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
            <header style={{ marginBottom: 28 }}>
              <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                <SetuIcon.back/> Back to family
              </Link>
              <div className="between">
                <div>
                  <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>The Patel Family</p>
                  <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>Add member</h1>
                </div>
              </div>
            </header>

            <div style={{ maxWidth: 720 }}>
              {formBody}
              <div style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
                <button className="btn btn--p" style={{ padding: '14px 28px' }}>Add member</button>
                <Link href="/family/members" className="btn btn--g">Cancel</Link>
              </div>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}
