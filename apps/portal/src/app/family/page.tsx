import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot, Stat, MetricCard, DesktopSidebar } from '@/features/family/components/atoms';

export default function FamilyDashboardPage() {
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div className="between" style={{ marginBottom: 22 }}>
              <SetuLogo size={18}/>
              <SetuAvatar name="Aarti Patel" size={32}/>
            </div>

            <div style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.02em' }}>Sunday, 14 June 2026</p>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                Namaste, Aarti.
              </h1>
            </div>

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}><em className="sa">Bala Vihar</em></span>
                <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
              </div>
              <div className="row" style={{ gap: 14, marginBottom: 14 }}>
                <Stat label="Next" value="Sun 10:00"/>
                <div style={{ width: 1, height: 36, background: 'var(--line)' }}/>
                <Stat label="Attendance" value="92%"/>
                <div style={{ width: 1, height: 36, background: 'var(--line)' }}/>
                <Stat label="Kids" value="2"/>
              </div>
              <button className="btn btn--s btn--block">Open class</button>
            </div>

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Donation pending</div>
                  <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2, letterSpacing: '-0.01em' }}>$500.00</div>
                </div>
                <Link href="/family/donate" className="btn btn--p">Give</Link>
              </div>
              <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: '0%', height: '100%', background: 'var(--accent)' }}/>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>$0 of $500 · Brampton Fall '26 · suggested</div>
            </div>

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Upcoming</span>
                <button className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>View all</button>
              </div>
              <div className="col" style={{ gap: 10 }}>
                {[
                  { d: '14', m: 'Jun', t: 'Class · 10:00 AM', sub: 'Brampton' },
                  { d: '21', m: 'Jun', t: 'Class · 10:00 AM', sub: 'Brampton' },
                  { d: '28', m: 'Jun', t: "No class · Father's Day", sub: null },
                ].map((e, i) => (
                  <div key={i} className="row" style={{ gap: 12 }}>
                    <div style={{ width: 42, padding: '6px 0', textAlign: 'center', background: 'var(--surface2)', borderRadius: 'var(--radiusSm)' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{e.m}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: -2 }}>{e.d}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{e.t}</div>
                      {e.sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.sub}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>My family · 4</span>
                <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Manage</Link>
              </div>
              <div className="row" style={{ gap: -6, flexWrap: 'wrap' }}>
                {['Aarti Patel', 'Raj Patel', 'Diya Patel', 'Arjun Patel'].map((n, i) => (
                  <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                    <div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}>
                      <SetuAvatar name={n} size={36}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mobile bottom nav */}
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-around', padding: '10px 8px 16px' }}>
            <Link href="/family" style={{ background: 'transparent', border: 0, color: 'var(--accent)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
              <SetuIcon.home/> Home
            </Link>
            <Link href="/family/members" style={{ background: 'transparent', border: 0, color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
              <SetuIcon.people/> Family
            </Link>
            <Link href="/family/donate" style={{ background: 'transparent', border: 0, color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
              <SetuIcon.heart/> Giving
            </Link>
            <button style={{ background: 'transparent', border: 0, color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600 }}>
              <SetuIcon.user/> Me
            </button>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="home"/>
          <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
            <header className="between" style={{ marginBottom: 28 }}>
              <div>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Sunday, 14 June 2026</p>
                <h1 style={{ fontSize: 32, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>Namaste, Aarti.</h1>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn--s"><SetuIcon.search/> Search</button>
                <Link href="/family/donate" className="btn btn--p">Give donation</Link>
              </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
              <MetricCard label="Attendance" value="92%" sub="14 / 15 classes" tone="ok"/>
              <MetricCard label="Donation"   value="$500" sub="pending · Fall '26" tone="warn"/>
              <MetricCard label="Next class" value="Sun · 10:00" sub="Brampton hall"/>
              <MetricCard label="Family"     value="4" sub="2 adults · 2 children"/>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
              <div className="card" style={{ padding: 24 }}>
                <div className="between" style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}><em className="sa">Bala Vihar</em> · Fall 2026</h3>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 4, marginBottom: 18 }}>
                  {Array.from({ length: 16 }).map((_, i) => {
                    const states = ['p','p','p','p','a','p','p','p','p','p','p','p','p','f','f','f'];
                    const s = states[i];
                    const bg = s === 'p' ? 'var(--accent)' : s === 'a' ? 'var(--err)' : 'var(--surface2)';
                    const op = s === 'p' ? 0.75 : 1;
                    return <div key={i} style={{ aspectRatio: '1', borderRadius: 4, background: bg, opacity: op, border: s === 'f' ? '1px dashed var(--line2)' : undefined }} title={`Week ${i + 1}`}/>;
                  })}
                </div>
                <div className="row" style={{ gap: 18, fontSize: 11, color: 'var(--muted)' }}>
                  <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, opacity: .75 }}/> present</span>
                  <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: 'var(--err)', borderRadius: 2 }}/> absent</span>
                  <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: 'var(--surface2)', borderRadius: 2, border: '1px dashed var(--line2)' }}/> upcoming</span>
                  <span style={{ marginLeft: 'auto' }}>14 of 15 attended · 1 absence</span>
                </div>
              </div>

              <div className="card" style={{ padding: 24 }}>
                <div className="between" style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Donation</span>
                  <SetuIcon.info color="var(--muted)"/>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>$500</span>
                  <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 14 }}>suggested</span>
                </div>
                <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: '0%', height: '100%', background: 'var(--accent)' }}/>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>$0 of $500 · Brampton Fall '26</div>
                <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, marginBottom: 18 }}>
                  Suggested, not required. Any amount welcome. Donations are tax-deductible.
                </p>
                <Link href="/family/donate" className="btn btn--p btn--block" style={{ display: 'flex' }}>Give donation</Link>
              </div>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}
