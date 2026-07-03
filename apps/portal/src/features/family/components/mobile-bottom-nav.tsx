'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { flags } from '@/lib/flags';
import { signOut } from './sign-out-button';

type Tab = 'home' | 'family' | 'programs' | 'giving' | 'more';

const TABS: { id: Tab; label: string; icon: keyof typeof SetuIcon; href: string }[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/family' },
  { id: 'family', label: 'Family', icon: 'people', href: '/family/members' },
  { id: 'programs', label: 'Programs', icon: 'grid', href: '/family/programs' },
  // Giving tab intentionally omitted — see MORE_ITEMS note below.
];

// Calendar links out to a yearly PDF when NEXT_PUBLIC_FAMILY_CALENDAR_URL is
// configured; otherwise it keeps the in-portal route. Literal process.env access
// so the value inlines into the client bundle.
const FAMILY_CALENDAR_URL = process.env.NEXT_PUBLIC_FAMILY_CALENDAR_URL;

// Secondary destinations that live in the "More" sheet rather than the bar.
// Built per-render so Seva can be filtered out when flags.setuSeva is off
// (Slice 1 Part C) and the Calendar entry can swap to the external PDF.
// Giving + Receipts ("My donations") are intentionally omitted: general
// donations are handled via a separate CMT process/site, not Stripe-in-portal
// (CMT decision 2026-06-04). The Bala Vihar donation flow stays reachable from
// the dashboard / enroll.
function moreItems(): { label: string; icon: keyof typeof SetuIcon; href: string; external?: boolean }[] {
  const items: { label: string; icon: keyof typeof SetuIcon; href: string; external?: boolean }[] = [];
  if (flags.setuSeva) items.push({ label: 'Seva', icon: 'heart', href: '/family/seva' });
  items.push(
    FAMILY_CALENDAR_URL
      ? { label: 'Calendar', icon: 'calendar', href: FAMILY_CALENDAR_URL, external: true }
      : { label: 'Calendar', icon: 'calendar', href: '/family/calendar' },
  );
  items.push({ label: 'Sign-in security', icon: 'shield', href: '/family/settings/security' });
  return items;
}

// Full-screen sub-flows render their own header/footer chrome (back button,
// sticky action button). Showing the tab bar there would overlap their footer,
// so the bar hides on these and the user navigates back via the page's own
// controls.
function shouldHide(pathname: string): boolean {
  if (pathname.startsWith('/family/settings')) return true;
  if (/^\/family\/members\/.+/.test(pathname)) return true; // detail / edit / new
  return false;
}

// The bar occupies ~64px at the bottom of the viewport. Pages with their own
// sticky action footer (enroll) subtract that via calc(100dvh - 64px) so the
// footer rests just above the bar instead of behind it.

function activeTab(pathname: string): Tab {
  if (pathname.startsWith('/family/members')) return 'family';
  // All program enrollment (incl. Bala Vihar) lives under Programs now.
  if (pathname.startsWith('/family/enroll') || pathname.startsWith('/family/programs')) return 'programs';
  if (pathname.startsWith('/family/donate') && !pathname.startsWith('/family/donations')) return 'giving';
  if (pathname.startsWith('/family/donations') || pathname.startsWith('/family/calendar') || pathname.startsWith('/family/seva') || pathname.startsWith('/family/settings')) {
    return 'more';
  }
  return 'home';
}

export function MobileBottomNav({ isAdmin = false, showTeacher = false }: { isAdmin?: boolean; showTeacher?: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const MORE_ITEMS = moreItems();
  if (shouldHide(pathname)) return null;
  const active = activeTab(pathname);

  const itemStyle = (on: boolean): React.CSSProperties => ({
    background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'none',
    color: on ? 'var(--accent)' : 'var(--muted)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)',
  });

  return (
    <>
      {moreOpen && (
        // `csp` so the sheet's brand tokens resolve outside any CspRoot.
        <div
          className="csp"
          onClick={() => setMoreOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', background: 'var(--surface)', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '8px 10px max(16px, env(safe-area-inset-bottom))', boxShadow: '0 -8px 30px rgba(0,0,0,0.12)' }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--line2)', margin: '6px auto 10px' }} />
            <div className="col" style={{ gap: 2 }}>
              {MORE_ITEMS.map((m) => {
                const Icon = SetuIcon[m.icon];
                const on = !m.external && pathname.startsWith(m.href);
                const style: React.CSSProperties = {
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px',
                  borderRadius: 'var(--radiusSm)', textDecoration: 'none',
                  color: on ? 'var(--accentDeep)' : 'var(--body-text)',
                  background: on ? 'var(--accentSoft)' : 'transparent',
                  fontSize: 15, fontWeight: 600,
                };
                return m.external ? (
                  <a
                    key={m.href}
                    href={m.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMoreOpen(false)}
                    style={style}
                  >
                    <Icon /> {m.label}
                  </a>
                ) : (
                  <Link key={m.href} href={m.href} onClick={() => setMoreOpen(false)} style={style}>
                    <Icon /> {m.label}
                  </Link>
                );
              })}
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMoreOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px',
                    borderRadius: 'var(--radiusSm)', textDecoration: 'none',
                    color: 'var(--body-text)', background: 'transparent', fontSize: 15, fontWeight: 600,
                  }}
                >
                  <SetuIcon.shield /> Admin
                </Link>
              )}
              {showTeacher && (
                <Link
                  href="/teacher"
                  onClick={() => setMoreOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px',
                    borderRadius: 'var(--radiusSm)', textDecoration: 'none',
                    color: 'var(--body-text)', background: 'transparent', fontSize: 15, fontWeight: 600,
                  }}
                >
                  <SetuIcon.people /> Teacher
                </Link>
              )}
              <div style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
              <button
                onClick={() => { void signOut(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px', width: '100%',
                  borderRadius: 'var(--radiusSm)', background: 'transparent', border: 0, cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--body)', textAlign: 'left',
                }}
              >
                <SetuIcon.user /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        // `csp` scopes the brand CSS tokens (--surface, --accent, …). Without it
        // this fixed bar renders outside any CspRoot, so the tokens resolve to
        // nothing — transparent background, default colors, content showing
        // through. Keep the class on the rendered bar.
        className="csp"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
          background: 'var(--surface)', borderTop: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-around', padding: '10px 8px 16px',
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
