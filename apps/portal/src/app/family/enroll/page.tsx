import Link from 'next/link';
import { SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, SectionLabel, DesktopSidebar } from '@/features/family/components/atoms';
import { mockEnrollment } from '@/features/family/data/mock';

export default function EnrollPage() {
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
              <span style={{ fontSize: 14, fontWeight: 600 }}>Enroll</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 100px' }}>
              <div style={{ padding: '18px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', right: -20, top: -20, opacity: .2 }}>
                  <Rosette size={120} color="#fff" stroke={.8}/>
                </div>
                <div style={{ position: 'relative' }}>
                  <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', opacity: .85, marginBottom: 6 }}>Enroll in</div>
                  <h1 style={{ fontSize: 26, fontWeight: 500, color: '#fff', fontFamily: 'var(--display)' }}><em className="sa">Bala Vihar</em> · Fall 2026</h1>
                  <p style={{ fontSize: 13, opacity: .9, marginTop: 8 }}>{mockEnrollment.schedule}</p>
                </div>
              </div>

              <SectionLabel>Who's enrolling</SectionLabel>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {mockEnrollment.children.map((m, i) => (
                  <div key={i} style={{ padding: 14, borderTop: i > 0 ? '1px solid var(--line)' : undefined, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: '2px solid var(--accent)', background: 'var(--accent)', display: 'grid', placeItems: 'center', color: '#fff' }}>
                      <SetuIcon.check color="#fff"/>
                    </div>
                    <SetuAvatar name={m.name} size={36}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.className}</div>
                    </div>
                  </div>
                ))}
              </div>

              <SectionLabel>What's included</SectionLabel>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
                {[
                  '16 Sunday classes (Sep – Jan)',
                  'Class materials and snacks',
                  'Year-end performance',
                  'Insurance and venue costs',
                ].map((s, i) => (
                  <div key={i} className="row" style={{ gap: 10, padding: '6px 0' }}>
                    <span style={{ color: 'var(--accent)' }}><SetuIcon.check/></span>
                    <span style={{ fontSize: 13 }}>{s}</span>
                  </div>
                ))}
              </div>

              <SectionLabel><em className="sa">Dakshina</em> · suggested donation</SectionLabel>
              <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 11, color: 'var(--accentDeep)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Brampton Fall '26 rate</div>
                <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--display)', fontSize: 40 }}>${mockEnrollment.suggestedDonation}</span>
                  <span style={{ fontSize: 13, color: 'var(--body-text)' }}>per family · suggested</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.5 }}>
                  Suggested, not required. The program runs entirely on family donations. <strong>Any amount welcome</strong> — and giving more keeps it running.
                </p>
              </div>
            </div>
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              <Link href="/family/donate" className="btn btn--p btn--block" style={{ display: 'flex' }}>Enroll & continue to donation →</Link>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="bv"/>
          <main style={{ flex: 1, padding: '28px 48px', overflow: 'auto' }}>
            <header style={{ marginBottom: 26 }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                <SetuIcon.back/> Back to dashboard
              </Link>
              <div className="between">
                <div>
                  <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Program enrollment</p>
                  <h1 style={{ fontSize: 40, fontWeight: 400, marginTop: 6 }}>
                    <em style={{ fontStyle: 'italic' }}>Bala Vihar</em> · Fall 2026
                  </h1>
                </div>
                <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>Brampton hall</span>
              </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
              <div>
                <div className="card" style={{ padding: 24, marginBottom: 14 }}>
                  <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>Children enrolling</h3>
                  <div className="col" style={{ gap: 10 }}>
                    {mockEnrollment.children.map((m, i) => (
                      <div key={i} style={{ padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                          <SetuIcon.check color="#fff"/>
                        </div>
                        <SetuAvatar name={m.name} size={44}/>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.grade}</div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--body-text)' }}>{m.className}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card" style={{ padding: 24 }}>
                  <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>What's included</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    {[
                      ['16 Sunday classes', 'Sep 7, 2026 — Jan 25, 2027'],
                      ['Class materials & snacks', 'Books, art supplies, healthy snacks'],
                      ['Year-end performance', 'Last week of January'],
                      ['Insurance & venue', 'Held at our Brampton hall'],
                    ].map(([t, sub], i) => (
                      <div key={i} className="row" style={{ gap: 12, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)' }}>
                        <div style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: '50%', background: 'var(--accentSoft)', color: 'var(--accentDeep)', display: 'grid', placeItems: 'center' }}>
                          <SetuIcon.check/>
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{t}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <aside>
                <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
                  <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
                    <em className="sa">Dakshina</em> · suggested donation
                  </h3>
                  <div style={{ padding: 18, background: 'var(--accentSoft)', borderRadius: 'var(--radiusSm)', marginBottom: 18 }}>
                    <div className="row" style={{ alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                      <span style={{ fontFamily: 'var(--display)', fontSize: 46, lineHeight: 1 }}>${mockEnrollment.suggestedDonation}</span>
                      <span style={{ fontSize: 13, color: 'var(--body-text)' }}>· per family</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Brampton Fall '26 rate · locked when you first attend</div>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, marginBottom: 18 }}>
                    This is a suggested donation, not a fee. The program runs entirely on family donations. <em className="sa">Sevaks</em> teach without pay. Any amount is welcome; giving more keeps the lights on.
                  </p>
                  <Link href="/family/donate" className="btn btn--p btn--block" style={{ display: 'flex' }}>Enroll & continue to donation →</Link>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
                    Donations are tax-deductible · Charity reg. CA-XXX-XXXX
                  </p>
                </div>
              </aside>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}
