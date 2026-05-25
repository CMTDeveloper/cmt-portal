import { Suspense } from 'react';
import { connection } from 'next/server';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot, Stat, MetricCard, SkeletonCard } from '@/features/family/components/atoms';
import { SignOutButton } from '@/features/family/components/sign-out-button';
import { flags } from '@/lib/flags';
import { mockFamily } from '@/features/family/data/mock';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

export default async function FamilyDashboardPage() {
  // Mark this page as dynamic — flags.setuAuth may be false in which case no
  // awaited request-data access happens before the request-time new Date()
  // below. connection() makes the rest of this component request-time only.
  await connection();
  let managerName = 'Family member';
  let familyName = mockFamily.name;
  let memberCount = mockFamily.members.length;
  let displayMembers: { name: string }[] = mockFamily.members.map((m) => ({ name: m.name }));
  let currentMid: string | null = null;

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      const currentMember = data.members.find((m) => m.mid === data.currentMid);
      if (currentMember) {
        managerName = `${currentMember.firstName} ${currentMember.lastName}`;
      }
      currentMid = data.currentMid;
      familyName = data.family.name;
      memberCount = data.members.length;
      displayMembers = data.members.map((m) => ({ name: `${m.firstName} ${m.lastName}` }));
    }
  }

  // Handle the lazy-migrated placeholder manager whose firstName is still
  // empty: show a neutral greeting and surface a Complete-your-profile CTA
  // (rendered below) so the user knows what to do next.
  const trimmedFirst = (managerName.split(' ')[0] ?? '').trim();
  const firstName = trimmedFirst || null;
  const needsProfile = !trimmedFirst;
  // Date rendered in America/Toronto so the dashboard greeting matches what
  // a sevak in the lobby sees on their clock (per CLAUDE.md B2 note 4).
  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Toronto',
  });
  void familyName;

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div className="between" style={{ marginBottom: 22 }}>
              <SetuLogo size={18}/>
              <SetuAvatar name={managerName} size={32}/>
            </div>

            <div style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.02em' }}>{todayLabel}</p>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                {firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}
              </h1>
            </div>
            {needsProfile && currentMid && (
              <Link href={`/family/members/${currentMid}/edit`} style={{ display: 'block', padding: '14px 16px', background: 'var(--accentSoft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', textDecoration: 'none', color: 'var(--accentDeep)', marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Complete your profile →</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>We don&apos;t have your name on file yet. Add it so sevaks know who to greet on Sunday.</div>
              </Link>
            )}

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}><em className="sa">Bala Vihar</em></span>
                <div className="row" style={{ gap: 6 }}>
                  <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)', fontSize: 10 }}>Sample data — real data coming soon</span>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
                </div>
              </div>
              <div className="row" style={{ gap: 14, marginBottom: 14 }}>
                <Stat label="Next" value="Sun 10:00"/>
                <div style={{ width: 1, height: 36, background: 'var(--line)' }}/>
                <Stat label="Attendance" value="92%"/>
                <div style={{ width: 1, height: 36, background: 'var(--line)' }}/>
                <Stat label="Kids" value="2"/>
              </div>
              <button className="btn btn--s btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>Open class</button>
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
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>$0 of $500 · Brampton Fall &#39;26 · suggested</div>
            </div>

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Upcoming</span>
                  <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)', fontSize: 10 }}>Sample data — real data coming soon</span>
                </div>
                <button className="focus-ring" disabled style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'not-allowed', opacity: 0.5 }}>View all</button>
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
                <span style={{ fontSize: 12, fontWeight: 600 }}>My family · {memberCount}</span>
                <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Manage</Link>
              </div>
              <div className="row" style={{ gap: -6, flexWrap: 'wrap' }}>
                {displayMembers.map((m, i) => (
                  <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                    <div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}>
                      <SetuAvatar name={m.name} size={36}/>
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
            <SignOutButton style={{ background: 'transparent', border: 0, color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600 }}/>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header className="between" style={{ marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{todayLabel}</p>
            <h1 style={{ fontSize: 32, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}</h1>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn--s" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}><SetuIcon.search/> Search</button>
            <Link href="/family/donate" className="btn btn--p">Give donation</Link>
          </div>
        </header>

        {needsProfile && currentMid && (
          <Link href={`/family/members/${currentMid}/edit`} style={{ display: 'block', padding: '16px 20px', background: 'var(--accentSoft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', textDecoration: 'none', color: 'var(--accentDeep)', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Complete your profile →</div>
            <div style={{ fontSize: 13, marginTop: 2 }}>We don&apos;t have your name on file yet. Add it so sevaks know who to greet on Sunday.</div>
          </Link>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
          <MetricCard label="Attendance" value="92%" sub="14 / 15 classes" tone="ok"/>
          <MetricCard label="Donation"   value="$500" sub="pending · Fall &#39;26" tone="warn"/>
          <MetricCard label="Next class" value="Sun · 10:00" sub="Brampton hall"/>
          <MetricCard label="Family"     value={String(memberCount)} sub={`${memberCount} member${memberCount !== 1 ? 's' : ''}`}/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
          <Suspense fallback={<SkeletonCard />}>
            <div className="card" style={{ padding: 24 }}>
              <div className="between" style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}><em className="sa">Bala Vihar</em> · Fall 2026</h3>
                <div className="row" style={{ gap: 6 }}>
                  <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)', fontSize: 10 }}>Sample data — real data coming soon</span>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
                </div>
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
          </Suspense>

          <Suspense fallback={<SkeletonCard />}>
            <div className="card" style={{ padding: 24 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Donation</span>
                <div className="row" style={{ gap: 6 }}>
                  <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)', fontSize: 10 }}>Sample data — real data coming soon</span>
                  <SetuIcon.info color="var(--muted)"/>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>$500</span>
                <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 14 }}>suggested</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: '0%', height: '100%', background: 'var(--accent)' }}/>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>$0 of $500 · {familyName} Fall &#39;26</div>
              <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, marginBottom: 18 }}>
                Suggested, not required. Any amount welcome. Donations are tax-deductible.
              </p>
              <Link href="/family/donate" className="btn btn--p btn--block" style={{ display: 'flex' }}>Give donation</Link>
            </div>
          </Suspense>
        </div>
      </div>
    </>
  );
}
