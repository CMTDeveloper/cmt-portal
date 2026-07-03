import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { MobileInviteButton, DesktopInviteButton } from './invite-button';
import { PromoteManagerButton } from './promote-manager-button';
import { mockFamily } from '@/features/family/data/mock';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { memberToDisplay, type DisplayMember } from './member-display';

export default async function FamilyRosterPage() {
  let familyName = mockFamily.name;
  let familyFid: string | number = mockFamily.fid;
  let familyLocation = mockFamily.location;
  let familyJoinedYear: string | number = mockFamily.joinedYear;
  let members: DisplayMember[] = mockFamily.members.map((m) => ({
    mid: m.mid,
    name: m.name,
    type: m.type === 'Child' ? `Child · ${m.grade ?? ''}` : 'Adult',
    tag: m.manager ? 'Manager' : null,
    isManager: m.manager,
    isAdult: m.type !== 'Child',
    warn: m.allergy?.summary ?? null,
    email: m.email,
    phone: m.phone,
    role: m.role,
    isCurrent: false,
    nameMissing: false,
    missingCount: 0,
  }));
  // Only a family manager may promote others; the mock view is read-only.
  let canManage = false;
  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      familyName = data.family.name;
      familyFid = data.family.fid;
      familyLocation = data.family.location;
      familyJoinedYear = data.family.createdAt.getFullYear();
      members = data.members.map((m) => memberToDisplay(m, data.currentMid));
      canManage = data.isManager;
    }
  }

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
                <h1 style={{ fontSize: 26, fontWeight: 400, marginBottom: 4 }}>The {familyName} Family</h1>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>FID {familyFid} · {familyLocation} · since {familyJoinedYear}</div>
              </div>

              <MobileInviteButton/>

              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Members · {members.length}</div>

              <div className="col" style={{ gap: 8 }}>
                {members.map((m, i) => (
                  <div key={i}>
                    <Link href={m.nameMissing && m.isCurrent ? `/family/members/${m.mid}/edit` : `/family/members/${m.mid}`} className="focus-ring" style={{ width: '100%', padding: 14, background: 'var(--surface)', border: m.isCurrent ? '1px solid var(--accent)' : '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
                      <SetuAvatar name={m.nameMissing ? '?' : m.name} size={44}/>
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: m.nameMissing ? 'var(--muted)' : 'inherit', fontStyle: m.nameMissing ? 'italic' : 'normal' }}>{m.name}</span>
                          {m.isCurrent && <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>You</span>}
                          {m.tag && <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>{m.tag}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {m.nameMissing && m.isCurrent ? 'Tap to add your name →' : m.type}
                        </div>
                        {m.missingCount > 0 && (
                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--warn, #a06410)', fontWeight: 600 }}>
                            {m.missingCount} field{m.missingCount !== 1 ? 's' : ''} to complete
                          </div>
                        )}
                        {m.warn && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 4 }}><SetuIcon.warn/> {m.warn}</div>}
                      </div>
                      <SetuIcon.chevron color="var(--muted)"/>
                    </Link>
                    {canManage && !m.isManager && m.isAdult && (
                      <PromoteManagerButton mid={m.mid} name={m.name} variant="mobile"/>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header className="between" style={{ marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>The {familyName} Family · FID {familyFid}</p>
            <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>My family</h1>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <DesktopInviteButton/>
            <Link href="/family/members/new" className="btn btn--p"><SetuIcon.plus/> Add member</Link>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {members.map((m, i) => (
            <div key={i} className="card" style={{ padding: 20, borderColor: m.isCurrent ? 'var(--accent)' : undefined, borderWidth: m.isCurrent ? 2 : 1, borderStyle: 'solid' }}>
              <div className="row" style={{ gap: 16, marginBottom: 14 }}>
                <SetuAvatar name={m.nameMissing ? '?' : m.name} size={56}/>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 18, fontFamily: 'var(--display)', fontWeight: 500, color: m.nameMissing ? 'var(--muted)' : 'inherit', fontStyle: m.nameMissing ? 'italic' : 'normal' }}>{m.name}</span>
                    {m.isCurrent && <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>You</span>}
                    {m.tag && <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>{m.tag}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.type}</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {m.missingCount > 0 && (
                    <Link href={`/family/members/${m.mid}/edit`} className="pill" style={{ background: 'var(--setu-warn-soft)', color: 'var(--warn, #a06410)', textDecoration: 'none', fontSize: 11 }}>
                      Complete info ({m.missingCount})
                    </Link>
                  )}
                  {canManage && !m.isManager && m.isAdult && (
                    <PromoteManagerButton mid={m.mid} name={m.name} variant="desktop"/>
                  )}
                  <Link href={`/family/members/${m.mid}/profile`} className="btn btn--s" style={{ padding: '6px 10px', fontSize: 12 }}>Profile</Link>
                  <Link href={`/family/members/${m.mid}/edit`} className="btn btn--s" style={{ padding: '6px 10px', fontSize: 12 }}><SetuIcon.edit/> Edit</Link>
                </div>
              </div>
              {m.nameMissing && m.isCurrent && (
                <Link href={`/family/members/${m.mid}/edit`} style={{ display: 'block', padding: '10px 14px', background: 'var(--accentSoft)', border: '1px solid var(--accent)', borderRadius: 'var(--radiusSm)', textDecoration: 'none', color: 'var(--accentDeep)', marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
                  Add your name & details →
                </Link>
              )}
              {m.warn && (
                <div style={{ padding: '8px 12px', background: '#fff3ec', border: '1px solid var(--err)', borderRadius: 'var(--radiusSm)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SetuIcon.warn color="var(--err)"/>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--err)' }}>Allergy: {m.warn}</span>
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--body-text)', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--mono)' }}>
                {m.email && <div className="row" style={{ gap: 6 }}><SetuIcon.mail color="var(--muted)"/> {m.email}</div>}
                {m.phone && <div className="row" style={{ gap: 6 }}><SetuIcon.phone color="var(--muted)"/> {m.phone}</div>}
                {m.role && <div className="row" style={{ gap: 6 }}><SetuIcon.heart color="var(--muted)"/> {m.role}</div>}
                {!m.email && !m.phone && !m.role && <div style={{ color: 'var(--muted)' }}>No contact info on file</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
