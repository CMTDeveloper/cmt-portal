import Link from 'next/link';
import { Rosette, SetuIcon } from '@cmt/ui';

export const metadata = { title: 'Admin — CMT Portal' };

// Admin landing — quick-jump tiles. The legacy /check-in/admin/* pages still
// own the data dashboards; this page is a themed entry point + jumping board
// to the welcome-team grant page (the only fully themed admin tool today).

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
          Manage CMT staff access and operational tools. The themed surface starts here;
          older check-in admin tools are still available in the sidebar (marked <em>Legacy</em>) until they're ported.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        <Tile
          href="/welcome"
          title="Family search"
          icon="search"
          sub="Look up any family by name, FID, legacy FID, email, or phone. Read-only family detail. Admins inherit welcome-team capability automatically."
          tone="primary"
        />
        <Tile
          href="/admin/welcome-team"
          title="Welcome-team grants"
          icon="people"
          sub="Grant + revoke welcome-team access for CMT volunteers helping families on Sunday."
          tone="primary"
        />
        <Tile
          href="/admin/programs"
          title="Programs"
          icon="people"
          sub="Manage programs (Bala Vihar, Tabla, etc.), their offerings per term, eligibility rules, and capabilities. Offerings replace the old donation-periods page."
          tone="primary"
        />
        <Tile
          href="/admin/donation-periods"
          title="Donation periods"
          icon="receipt"
          sub="Legacy: redirects to Programs → Offerings. Kept for bookmarks."
          tone="legacy"
        />
        <Tile
          href="/admin/levels"
          title="Levels & teachers"
          icon="check"
          sub="Configure Bala Vihar levels (classes) per location + period, set grade-bands, and assign teachers. Assignment grants the teacher capability on next sign-in."
          tone="primary"
        />
        <Tile
          href="/admin/school-year"
          title="School year rollover"
          icon="check"
          sub="Promote Bala Vihar families to the next school year — advance grades, re-assign levels, keep each child's history."
          tone="primary"
        />
        <Tile
          href="/admin/calendar"
          title="Class calendar"
          icon="calendar"
          sub="Publish the school-year Sunday schedule (class / no-class days, special events) + weekly times. Replaces the per-year PDF; families see it on their dashboard."
          tone="primary"
        />
        <Tile
          href="/admin/volunteering-skills"
          title="Volunteering skills"
          icon="check"
          sub="Manage the list of volunteering skills families choose from when recording an adult member's skills."
          tone="primary"
        />
        <Tile
          href="/check-in/admin/users"
          title="Admin users"
          icon="shield"
          sub="Legacy: add or remove other admins. (Themed version coming.)"
          tone="legacy"
        />
        <Tile
          href="/check-in/admin/unpaid"
          title="Unpaid families"
          icon="warn"
          sub="Legacy: list of families whose dakshina is outstanding."
          tone="legacy"
        />
        <Tile
          href="/check-in/admin/guests"
          title="Guests"
          icon="people"
          sub="Legacy: recent guest check-ins from the Sunday kiosk."
          tone="legacy"
        />
        <Tile
          href="/check-in/admin/reports"
          title="Reports"
          icon="info"
          sub="Legacy: attendance and engagement reports."
          tone="legacy"
        />
        <Tile
          href="/check-in/admin"
          title="Check-in dashboard"
          icon="home"
          sub="Legacy: live check-in counts and operational stats."
          tone="legacy"
        />
      </div>

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
