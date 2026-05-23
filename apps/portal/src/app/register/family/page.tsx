import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, StepHeader, AddedMemberRow } from '@/features/family/components/atoms';

export default function RegisterFamilyPage() {
  const formContent = (
    <>
      <StepHeader step={2} of={2} label="Family details"/>
      <h1 style={{ fontSize: 26, fontWeight: 400, marginTop: 18, marginBottom: 18 }}>Tell us about your family.</h1>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Family name <span className="req">·</span></label>
        <input className="input" type="text" defaultValue="Patel"/>
        <div className="hint">Used in greetings — "The Patel Family"</div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Primary location <span className="req">·</span></label>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const).map((l, i) => (
            <button key={i} className="pill" style={{
              padding: '8px 12px', fontSize: 13,
              background: i === 0 ? 'var(--accent)' : 'var(--surface)',
              color: i === 0 ? '#fff' : 'var(--body-text)',
              border: '1px solid', borderColor: i === 0 ? 'var(--accent)' : 'var(--line2)',
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 18 }}>
        <label>I'm the family manager</label>
        <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
          <div className="row" style={{ gap: 10 }}>
            <SetuAvatar name="Raj Patel" size={40}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Raj Patel</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>raj.patel@gmail.com · (416) 555-2204</div>
            </div>
            <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Manager</span>
          </div>
          <button className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontWeight: 600, fontSize: 12, marginTop: 10, padding: 0 }}>
            Edit my details →
          </button>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 6 }}>
        <label>Add at least one family member</label>
      </div>
      <div className="col" style={{ gap: 10, marginBottom: 18 }}>
        <AddedMemberRow name="Aarti Patel" type="Adult · spouse"/>
        <AddedMemberRow name="Diya Patel" type="Child · Gr 3"/>
        <button className="focus-ring" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px', background: 'transparent', border: '1px dashed var(--line2)', borderRadius: 'var(--radius)', color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
          <SetuIcon.plus/> Add another member
        </button>
      </div>

      <Link href="/family" className="btn btn--p btn--block" style={{ display: 'flex' }}>Create family & continue →</Link>
      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
        You can edit anything after — this is just to get you started.
      </p>
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '10px 24px 30px', minHeight: '100dvh', overflowY: 'auto' }}>
            <Link href="/register" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, marginBottom: 12, color: 'var(--body-text)', display: 'inline-flex' }}>
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
              <Link href="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--body-text)', textDecoration: 'none', fontSize: 13, marginBottom: 40 }}>
                <SetuIcon.back/> Back
              </Link>
              <SetuLogo size={22}/>
            </div>

            <div style={{ maxWidth: 520, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
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
              <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Step 2 of 2</p>
              <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>
                "Your family profile is the foundation — enrollment, attendance and receipts all flow from here."
              </p>
              <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>
                You can add or edit members at any time from the family dashboard.
              </p>
            </div>
          </div>
        </CspRoot>
      </div>
    </>
  );
}
