import Link from 'next/link';
import { Rosette } from '@cmt/ui';

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
        <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>
          Hari OM, admin.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 620, lineHeight: 1.55 }}>
          Manage CMT staff access and operational tools. The themed surface starts here;
          older check-in admin tools are still available in the sidebar (marked <em>Legacy</em>) until they're ported.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        <Tile
          href="/welcome"
          title="Family search"
          sub="Look up any family by name, FID, legacy FID, email, or phone. Read-only family detail. Admins inherit welcome-team capability automatically."
          tone="primary"
        />
        <Tile
          href="/admin/welcome-team"
          title="Welcome-team grants"
          sub="Grant + revoke welcome-team access for CMT volunteers helping families on Sunday."
          tone="primary"
        />
        <Tile
          href="/check-in/admin/users"
          title="Admin users"
          sub="Legacy: add or remove other admins. (Themed version coming.)"
          tone="legacy"
        />
        <Tile
          href="/check-in/admin/unpaid"
          title="Unpaid families"
          sub="Legacy: list of families whose dakshina is outstanding."
          tone="legacy"
        />
        <Tile
          href="/check-in/admin/guests"
          title="Guests"
          sub="Legacy: recent guest check-ins from the Sunday kiosk."
          tone="legacy"
        />
        <Tile
          href="/check-in/admin/reports"
          title="Reports"
          sub="Legacy: attendance and engagement reports."
          tone="legacy"
        />
        <Tile
          href="/check-in/admin"
          title="Check-in dashboard"
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

function Tile({ href, title, sub, tone }: { href: string; title: string; sub: string; tone: 'primary' | 'legacy' }) {
  const isPrimary = tone === 'primary';
  return (
    <Link href={href} style={{
      display: 'block', padding: 18, borderRadius: 'var(--radius)',
      background: isPrimary ? 'var(--accentSoft)' : 'var(--surface)',
      border: `1px solid ${isPrimary ? 'var(--accent)' : 'var(--line)'}`,
      textDecoration: 'none', color: 'var(--body-text)',
      transition: 'transform 120ms ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: isPrimary ? 'var(--accentDeep)' : 'var(--ink)' }}>{title}</span>
        {tone === 'legacy' && (
          <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Legacy</span>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--body-text)', lineHeight: 1.5, marginTop: 6 }}>{sub}</p>
    </Link>
  );
}
