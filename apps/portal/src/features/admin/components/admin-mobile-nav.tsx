'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { signOut } from '@/features/family/components/sign-out-button';

type Tab = 'home' | 'programs' | 'levels' | 'calendar' | 'more';

const TABS: { id: Tab; label: string; icon: keyof typeof SetuIcon; href: string }[] = [
  { id: 'home',     label: 'Home',     icon: 'home',     href: '/admin' },
  { id: 'programs', label: 'Programs', icon: 'people',   href: '/admin/programs' },
  { id: 'levels',   label: 'Levels',   icon: 'check',    href: '/admin/levels' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/admin/calendar' },
];

// Mirrors the grouped IA: People & access + Bala Vihar extras not already in
// the bottom tabs, then the legacy door-app tools.
// Reports is its OWN top-level section on desktop/sidebar — keep it out of the
// "Legacy tools" group here so the mobile IA matches (parity finding).
const MORE_THEMED: { label: string; icon: keyof typeof SetuIcon; href: string }[] = [
  { label: 'Family search', icon: 'search', href: '/welcome' },
  { label: 'Users & roles', icon: 'people', href: '/admin/users' },
  { label: 'School year rollover', icon: 'check', href: '/admin/school-year' },
  { label: 'Prasad rotation', icon: 'heart', href: '/admin/prasad' },
  { label: 'Volunteering skills', icon: 'check', href: '/admin/volunteering-skills' },
  { label: 'Locations', icon: 'home', href: '/admin/locations' },
  { label: 'Seva', icon: 'heart', href: '/welcome/seva' },
  { label: 'Reports', icon: 'info', href: '/welcome/reports' },
];

const MORE_LEGACY: { label: string; href: string }[] = [
  { label: 'Admin users', href: '/check-in/admin/users' },
  { label: 'Guests', href: '/check-in/admin/guests' },
  { label: 'Unpaid families', href: '/check-in/admin/unpaid' },
  { label: 'Check-in dashboard', href: '/check-in/admin' },
];

function activeTab(pathname: string): Tab {
  if (pathname.startsWith('/admin/programs')) return 'programs';
  if (pathname.startsWith('/admin/levels')) return 'levels';
  if (pathname.startsWith('/admin/calendar')) return 'calendar';
  if (pathname === '/admin') return 'home';
  return 'more';
}

export function AdminMobileNav({ hasFamily = false, showTeacher = false }: { hasFamily?: boolean; showTeacher?: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const active = activeTab(pathname);

  // minHeight/minWidth keep every tab ≥44px (a11y tap target); inactive uses
  // --body-text not --muted (the latter ≈2.9:1 on white, below AA at 11px).
  const itemStyle = (on: boolean): React.CSSProperties => ({
    background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'none',
    color: on ? 'var(--accent)' : 'var(--body-text)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
    minHeight: 44, minWidth: 56, padding: '4px 6px',
    fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)',
  });

  const sheetLink: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px',
    borderRadius: 'var(--radiusSm)', textDecoration: 'none', fontSize: 15, fontWeight: 600,
    color: 'var(--body-text)', background: 'transparent',
  };

  return (
    <>
      {moreOpen && (
        <div
          className="csp"
          onClick={() => setMoreOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '8px 10px max(16px, env(safe-area-inset-bottom))', boxShadow: '0 -8px 30px rgba(0,0,0,0.12)' }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--line2)', margin: '6px auto 10px' }} />
            <div className="col" style={{ gap: 2 }}>
              {MORE_THEMED.map((m) => {
                const Icon = SetuIcon[m.icon];
                const on = pathname.startsWith(m.href);
                return (
                  <Link key={m.href} href={m.href} onClick={() => setMoreOpen(false)} style={{ ...sheetLink, color: on ? 'var(--accentDeep)' : 'var(--body-text)', background: on ? 'var(--accentSoft)' : 'transparent' }}>
                    <Icon /> <span>{m.label}</span>
                  </Link>
                );
              })}
              <div style={{ padding: '12px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Legacy tools</div>
              {MORE_LEGACY.map((m) => (
                <Link key={m.href} href={m.href} onClick={() => setMoreOpen(false)} style={{ ...sheetLink, color: 'var(--body-text)' }}>
                  <SetuIcon.shield /> <span>{m.label}</span>
                </Link>
              ))}
              <div style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
              {showTeacher && (
                <Link href="/teacher" onClick={() => setMoreOpen(false)} style={sheetLink}>
                  <SetuIcon.people /> Teacher
                </Link>
              )}
              {hasFamily && (
                <Link href="/family" onClick={() => setMoreOpen(false)} style={sheetLink}>
                  <SetuIcon.back /> Back to my family
                </Link>
              )}
              <button
                onClick={() => { void signOut(); }}
                style={{ ...sheetLink, width: '100%', border: 0, cursor: 'pointer', color: 'var(--muted)', fontFamily: 'var(--body)', textAlign: 'left' }}
              >
                <SetuIcon.user /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="csp"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
          background: 'var(--surface)', borderTop: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-around', padding: '10px 8px max(16px, env(safe-area-inset-bottom))',
        }}
      >
        {TABS.map((t) => {
          const Icon = SetuIcon[t.icon];
          return (
            <Link key={t.id} href={t.href} style={itemStyle(t.id === active)}>
              <Icon /> {t.label}
            </Link>
          );
        })}
        <button
          type="button"
          aria-label="More"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          style={itemStyle(active === 'more' || moreOpen)}
        >
          <SetuIcon.dots /> More
        </button>
      </div>
    </>
  );
}
