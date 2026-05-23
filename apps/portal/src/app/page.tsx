import Link from 'next/link';
import { Rosette, SetuLogo } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';

export default function HomePage() {
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh', position: 'relative', display: 'flex', flexDirection: 'column', padding: '30px 24px 30px' }}>
          <div style={{ position: 'absolute', right: -50, top: 60, opacity: .12, pointerEvents: 'none' }}>
            <Rosette size={260} color="var(--accent)" stroke={.7}/>
          </div>
          <div style={{ flex: '0 0 auto' }}><SetuLogo size={20}/></div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 20 }}>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Chinmaya Mission Toronto</p>
            <h1 style={{ fontSize: 40, lineHeight: 1.05, marginTop: 8, fontWeight: 400 }}>
              The family portal for <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>our mission</em>.
            </h1>
            <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 14, lineHeight: 1.6 }}>
              Enroll in <em className="sa">Bala Vihar</em>, manage your family, and give your <em className="sa">dakshina</em> — all in one place. Member access only.
            </p>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <Link href="/sign-in" className="btn btn--p btn--block" style={{ marginBottom: 10 }}>Sign in or register →</Link>
            <a href="https://chinmayatoronto.org" className="btn btn--g btn--block" style={{ fontSize: 13 }}>Visit chinmayatoronto.org</a>
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Have an invite? Open the link from your email.</p>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh', background: 'var(--setu-bg)' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.2 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ marginBottom: 'auto' }}>
              <SetuLogo size={22}/>
              <div className="row" style={{ gap: 18, fontSize: 13, color: 'var(--body-text)' }}>
                <span style={{ color: 'inherit' }}>About</span>
                <a href="https://events.chinmayatoronto.org/" style={{ color: 'inherit' }}>Events ↗</a>
                <a href="mailto:info@chinmayatoronto.org" style={{ color: 'inherit' }}>Contact</a>
              </div>
            </div>
            <div style={{ maxWidth: 520, paddingBottom: 80 }}>
              <p style={{ fontSize: 12, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>Chinmaya Mission Toronto · members only</p>
              <h1 style={{ fontSize: 64, lineHeight: 1.02, marginTop: 12, fontWeight: 400 }}>
                The family portal for <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>our mission</em>.
              </h1>
              <p style={{ fontSize: 17, color: 'var(--body-text)', marginTop: 22, lineHeight: 1.6 }}>
                One place for <em className="sa">Bala Vihar</em> enrollment, attendance, donation receipts, and your family's profile. We'll send a one-time link to your email — no password needed.
              </p>
              <div className="row" style={{ marginTop: 32, gap: 12 }}>
                <Link href="/sign-in" className="btn btn--p" style={{ padding: '14px 22px' }}>Sign in or register →</Link>
              </div>
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Have an invite link? Open it from your email.</p>
            </div>
            <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>Chinmaya Mission Toronto</span>
              <span style={{ marginLeft: 'auto' }}>© 2026 CMT</span>
            </div>
          </div>
          <div style={{ flex: '1 1 0', background: 'var(--accent)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 48 }}>
            <div style={{ position: 'absolute', inset: 0, opacity: .15, display: 'grid', placeItems: 'center' }}>
              <Rosette size={520} color="#fff" stroke={.5}/>
            </div>
            <div style={{ position: 'relative', color: '#fff' }}>
              <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Sanskrit · setu</p>
              <p style={{ fontFamily: 'var(--display)', fontSize: 28, fontStyle: 'italic', lineHeight: 1.3, fontWeight: 400 }}>
                "a bridge — connecting families, sevaks, and the mission they share."
              </p>
            </div>
          </div>
        </CspRoot>
      </div>
    </>
  );
}
