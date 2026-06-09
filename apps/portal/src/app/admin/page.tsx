import Link from 'next/link';
import { Rosette, SetuIcon } from '@cmt/ui';

export const metadata = { title: 'Admin — CMT Portal' };

// Admin landing — quick-jump tiles. The legacy /check-in/admin/* pages still
// own the data dashboards; this page is a themed entry point + jumping board
// to the welcome-team grant page (the only fully themed admin tool today).

// Group data drives the render. tone 'legacy' keeps the muted treatment + badge.
const GROUPS: Array<{
  heading: string;
  blurb?: string;
  tiles: Array<{ href: string; title: string; icon: keyof typeof SetuIcon; sub: string; tone: 'primary' | 'legacy' }>;
}> = [
  {
    heading: 'People & access',
    tiles: [
      { href: '/welcome', title: 'Family search', icon: 'search', tone: 'primary', sub: 'Look up any family by name, FID, legacy FID, email, or phone. Read-only family detail.' },
      { href: '/admin/welcome-team', title: 'Welcome-team grants', icon: 'people', tone: 'primary', sub: 'Grant + revoke welcome-team access for CMT volunteers helping families on Sunday.' },
    ],
  },
  {
    heading: 'Bala Vihar',
    tiles: [
      { href: '/admin/programs', title: 'Programs', icon: 'people', tone: 'primary', sub: 'Manage programs (Bala Vihar, Tabla, etc.), their offerings per term, eligibility, and capabilities.' },
      { href: '/admin/levels', title: 'Level management', icon: 'check', tone: 'primary', sub: 'Configure Bala Vihar levels per location + period, set grade-bands, and assign the teachers who cover each one.' },
      { href: '/admin/calendar', title: 'Class calendar', icon: 'calendar', tone: 'primary', sub: 'Publish the school-year Sunday schedule + weekly times. Families see it on their dashboard.' },
      { href: '/admin/school-year', title: 'School year rollover', icon: 'check', tone: 'primary', sub: 'Promote Bala Vihar families to the next school year — advance grades, re-assign levels, keep history.' },
      { href: '/admin/volunteering-skills', title: 'Volunteering skills', icon: 'check', tone: 'primary', sub: 'Manage the list of volunteering skills families choose from for adult members.' },
      { href: '/welcome/seva', title: 'Seva', icon: 'heart', tone: 'primary', sub: 'Manage seva opportunities and review volunteer signups.' },
    ],
  },
  {
    heading: 'Reports',
    tiles: [
      { href: '/check-in/admin/reports', title: 'Reports', icon: 'info', tone: 'legacy', sub: 'Legacy: attendance + engagement CSV exports. A unified Reports hub is coming.' },
    ],
  },
  {
    heading: 'Legacy · door app',
    blurb: 'Standalone check-in kiosk tools. Retiring after the door cutover.',
    tiles: [
      { href: '/check-in/admin', title: 'Check-in dashboard', icon: 'home', tone: 'legacy', sub: 'Live check-in counts and operational stats.' },
      { href: '/check-in/admin/guests', title: 'Guests', icon: 'people', tone: 'legacy', sub: 'Recent guest check-ins from the Sunday kiosk.' },
      { href: '/check-in/admin/unpaid', title: 'Unpaid families', icon: 'warn', tone: 'legacy', sub: 'Families whose dakshina is outstanding.' },
      { href: '/check-in/admin/users', title: 'Admin users', icon: 'shield', tone: 'legacy', sub: 'Add or remove other admins.' },
      { href: '/admin/donation-periods', title: 'Donation periods', icon: 'receipt', tone: 'legacy', sub: 'Redirects to Programs → Offerings. Kept for bookmarks.' },
    ],
  },
];

function Section({ heading, blurb, children }: { heading: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>{heading}</h2>
        {blurb && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{blurb}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

export default function AdminPage() {
  return (
    <>
      <header style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Chinmaya Mission Toronto · Admin
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>
          Hari OM, admin.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 620, lineHeight: 1.55 }}>
          Manage CMT staff access and operational tools, grouped by area. The themed surface starts here;
          older check-in admin tools are still available (marked <em>Legacy</em>) until they're ported.
        </p>
      </header>

      {GROUPS.map((group) => (
        <Section
          key={group.heading}
          heading={group.heading}
          {...(group.blurb !== undefined ? { blurb: group.blurb } : {})}
        >
          {group.tiles.map((tile) => (
            <Tile
              key={tile.href}
              href={tile.href}
              title={tile.title}
              icon={tile.icon}
              sub={tile.sub}
              tone={tile.tone}
            />
          ))}
        </Section>
      ))}

      <div style={{ marginTop: 28, padding: 22, background: 'var(--accentSoft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Rosette size={56} color="var(--accentDeep)" stroke={1}/>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)', marginBottom: 4 }}>
            About this surface
          </p>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55 }}>
            Admins now sign in via the same OTP flow as families and welcome-team
            (no password). Roles are granted via <code>scripts/grant-admin.ts</code> or
            another admin's <em>Admin users</em> page.
          </p>
        </div>
      </div>
    </>
  );
}

function Tile({ href, title, sub, tone, icon }: { href: string; title: string; sub: string; tone: 'primary' | 'legacy'; icon: keyof typeof SetuIcon }) {
  const isPrimary = tone === 'primary';
  const Icon = SetuIcon[icon];
  return (
    <Link href={href} className="focus-ring" style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, borderRadius: 'var(--radius)',
      background: isPrimary ? 'var(--accentSoft)' : 'var(--surface)',
      border: `1px solid ${isPrimary ? 'var(--accent)' : 'var(--line)'}`,
      textDecoration: 'none', color: 'var(--body-text)',
    }}>
      <div style={{
        flex: '0 0 auto', width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center',
        background: isPrimary ? 'var(--surface)' : 'var(--surface2)',
        color: isPrimary ? 'var(--accentDeep)' : 'var(--muted)',
      }}>
        <Icon />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: isPrimary ? 'var(--accentDeep)' : 'var(--ink)' }}>{title}</span>
          {tone === 'legacy' && (
            <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Legacy</span>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--body-text)', lineHeight: 1.5 }}>{sub}</p>
      </div>
      <div style={{ flex: '0 0 auto', alignSelf: 'center', color: 'var(--muted)' }}>
        <SetuIcon.chevron />
      </div>
    </Link>
  );
}
