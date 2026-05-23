import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot, DesktopSidebar } from '@/features/family/components/atoms';
import { MobileInviteButton, DesktopInviteButton } from './invite-button';
import { mockFamily } from '@/features/family/data/mock';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import type { MemberDoc } from '@cmt/shared-domain/setu';

type DisplayMember = {
  mid: string;
  name: string;
  type: string;
  tag: string | null;
  warn: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
};

function memberToDisplay(m: MemberDoc): DisplayMember {
  const name = `${m.firstName} ${m.lastName}`;
  const typeLabel = m.type === 'Child'
    ? `Child${m.schoolGrade ? ` · ${m.schoolGrade}` : ''}`
    : 'Adult';
  return {
    mid: m.mid,
    name,
    type: typeLabel,
    tag: m.manager ? 'Manager' : null,
    warn: m.foodAllergies ?? null,
    email: m.email,
    phone: m.phone,
    role: m.volunteeringSkills.length > 0 ? m.volunteeringSkills.join(', ') : null,
  };
}

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
    warn: m.allergy?.summary ?? null,
    email: m.email,
    phone: m.phone,
    role: m.role,
  }));

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      familyName = data.family.name;
      familyFid = data.family.fid;
      familyLocation = data.family.location;
      familyJoinedYear = data.family.createdAt.getFullYear();
      members = data.members.map(memberToDisplay);
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
                  <Link key={i} href={`/family/members/${m.mid}`} className="focus-ring" style={{ width: '100%', padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
                    <SetuAvatar name={m.name} size={44}/>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</span>
                        {m.tag && <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>{m.tag}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.type}</div>
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
                <div key={i} className="card" style={{ padding: 20 }}>
                  <div className="row" style={{ gap: 16, marginBottom: 14 }}>
                    <SetuAvatar name={m.name} size={56}/>
                    <div style={{ flex: 1 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontSize: 18, fontFamily: 'var(--display)', fontWeight: 500 }}>{m.name}</span>
                        {m.tag && <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>{m.tag}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.type}</div>
                    </div>
                    <Link href={`/family/members/${m.mid}/edit`} className="btn btn--s" style={{ padding: '6px 10px', fontSize: 12 }}><SetuIcon.edit/> Edit</Link>
                  </div>
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
          </main>
        </CspRoot>
      </div>
    </>
  );
}
