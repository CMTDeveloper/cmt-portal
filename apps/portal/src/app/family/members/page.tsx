import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot, DesktopSidebar } from '@/features/family/components/atoms';
import { mockFamily } from '@/features/family/data/mock';

const MEMBERS = [
  { n: 'Aarti Patel',  age: 36, t: 'Adult',        tag: 'Manager', warn: null,             mid: '4421-01', e: 'aarti.patel@gmail.com', p: '(416) 555-3387', role: 'Volunteer · Teaching', grade: null },
  { n: 'Raj Patel',    age: 38, t: 'Adult',        tag: null,      warn: null,             mid: '4421-02', e: 'raj.patel@gmail.com',   p: '(416) 555-2204', role: 'Volunteer · AV',      grade: null },
  { n: 'Diya Patel',   age: 8,  t: 'Child · Gr 3', tag: null,      warn: 'peanut allergy', mid: '4421-03', e: null, p: null, role: null, grade: 'Grade 3' },
  { n: 'Arjun Patel',  age: 6,  t: 'Child · Gr 1', tag: null,      warn: null,             mid: '4421-04', e: null, p: null, role: null, grade: 'Grade 1' },
];

export default function FamilyRosterPage() {
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
              <span style={{ fontSize: 14, fontWeight: 600 }}>My family</span>
              <Link href="/family/members/new" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, color: 'var(--accent)', display: 'inline-flex' }}>
                <SetuIcon.plus/>
              </Link>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 90px' }}>
              <div style={{ marginBottom: 18 }}>
                <h1 style={{ fontSize: 26, fontWeight: 400, marginBottom: 4 }}>The {mockFamily.name} Family</h1>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>FID {mockFamily.fid} · {mockFamily.location} · since {mockFamily.joinedYear}</div>
              </div>

              <button className="focus-ring" style={{ width: '100%', padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', color: 'var(--accentDeep)' }}>
                  <SetuIcon.mail/>
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Invite a co-manager</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Spouse or other parent can co-manage</div>
                </div>
                <SetuIcon.chevron color="var(--muted)"/>
              </button>

              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Members · 4</div>

              <div className="col" style={{ gap: 8 }}>
                {MEMBERS.map((m, i) => (
                  <Link key={i} href={`/family/members/${m.mid}`} className="focus-ring" style={{ width: '100%', padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
                    <SetuAvatar name={m.n} size={44}/>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{m.n}</span>
                        {m.tag && <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>{m.tag}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.t} · age {m.age}</div>
                      {m.warn && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 4 }}><SetuIcon.warn/> {m.warn}</div>}
                    </div>
                    <SetuIcon.chevron color="var(--muted)"/>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="family"/>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
            <header className="between" style={{ marginBottom: 24 }}>
              <div>
                <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>The {mockFamily.name} Family · FID {mockFamily.fid}</p>
                <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>My family</h1>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn--s"><SetuIcon.mail/> Invite co-manager</button>
                <Link href="/family/members/new" className="btn btn--p"><SetuIcon.plus/> Add member</Link>
              </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              {MEMBERS.map((m, i) => (
                <div key={i} className="card" style={{ padding: 20 }}>
                  <div className="row" style={{ gap: 16, marginBottom: 14 }}>
                    <SetuAvatar name={m.n} size={56}/>
                    <div style={{ flex: 1 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontSize: 18, fontFamily: 'var(--display)', fontWeight: 500 }}>{m.n}</span>
                        {m.tag && <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>{m.tag}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.t} · age {m.age}{m.grade ? ` · ${m.grade}` : ''}</div>
                    </div>
                    <Link href={`/family/members/${m.mid}`} className="btn btn--s" style={{ padding: '6px 10px', fontSize: 12 }}><SetuIcon.edit/> Edit</Link>
                  </div>
                  {m.warn && (
                    <div style={{ padding: '8px 12px', background: '#fff3ec', border: '1px solid var(--err)', borderRadius: 'var(--radiusSm)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <SetuIcon.warn color="var(--err)"/>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--err)' }}>Allergy: Peanuts · severe</span>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--body-text)', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--mono)' }}>
                    {m.e && <div className="row" style={{ gap: 6 }}><SetuIcon.mail color="var(--muted)"/> {m.e}</div>}
                    {m.p && <div className="row" style={{ gap: 6 }}><SetuIcon.phone color="var(--muted)"/> {m.p}</div>}
                    {m.role && <div className="row" style={{ gap: 6 }}><SetuIcon.heart color="var(--muted)"/> {m.role}</div>}
                    {!m.e && !m.p && !m.role && <div style={{ color: 'var(--muted)' }}>No contact info on file</div>}
                  </div>
                </div>
              ))}
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}
