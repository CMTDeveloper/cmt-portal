import Link from 'next/link';
import { SetuLogo, SetuAvatar, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';

export default function InvitePage() {
  const inviteContent = (
    <>
      <div style={{ alignSelf: 'flex-start', padding: '4px 10px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontSize: 11, fontWeight: 600, marginBottom: 18 }}>
        You've been invited
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 400, lineHeight: 1.15, marginBottom: 14 }}>
        <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Raj Patel</em> is inviting you to join the Patel family on Setu.
      </h1>
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 26 }}>
        Once you accept, you'll be able to manage <em className="sa">Bala Vihar</em> enrollment, attendance and donations for everyone in your household — including Diya and Arjun.
      </p>
      <div style={{ padding: 18, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 20 }}>
        <div className="row" style={{ gap: -6, marginBottom: 10 }}>
          {['Raj Patel', 'Diya Patel', 'Arjun Patel'].map((n, i) => (
            <div key={i} style={{ marginLeft: i > 0 ? -8 : 0, border: '2px solid var(--surface)', borderRadius: '50%' }}>
              <SetuAvatar name={n} size={36}/>
            </div>
          ))}
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>The Patel Family</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Brampton · 3 members</div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '40px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <SetuLogo size={18}/>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {inviteContent}
            </div>
            <Link href="/family" className="btn btn--p btn--block" style={{ marginBottom: 10, display: 'flex' }}>Accept & join →</Link>
            <button className="btn btn--g btn--block" style={{ fontSize: 13 }}>Decline this invite</button>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          {/* Left pane — content */}
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <SetuLogo size={22}/>
            </div>

            <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {inviteContent}
              <Link href="/family" className="btn btn--p btn--block" style={{ marginBottom: 10, display: 'flex', padding: '14px 22px' }}>Accept & join →</Link>
              <button className="btn btn--g btn--block" style={{ fontSize: 13 }}>Decline this invite</button>
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
              <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Family invite</p>
              <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>
                "Joining your family on Setu means one shared view of enrollment, attendance, and giving — for the whole household."
              </p>
              <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>
                Co-managers can enroll children, record attendance, and manage donations together.
              </p>
            </div>
          </div>
        </CspRoot>
      </div>
    </>
  );
}
