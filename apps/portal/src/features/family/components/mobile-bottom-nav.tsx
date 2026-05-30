'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

type Tab = 'home' | 'family' | 'bv' | 'giving';

const TABS: { id: Tab; label: string; icon: keyof typeof SetuIcon; href: string }[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/family' },
  { id: 'family', label: 'Family', icon: 'people', href: '/family/members' },
  { id: 'bv', label: 'Bala Vihar', icon: 'check', href: '/family/enroll' },
  { id: 'giving', label: 'Giving', icon: 'heart', href: '/family/donate' },
];

// Full-screen sub-flows render their own header/footer chrome (back button,
// sticky action button). Showing the tab bar there would overlap their footer,
// so the bar hides on these and the user navigates back via the page's own
// controls.
function shouldHide(pathname: string): boolean {
  if (pathname.startsWith('/family/enroll')) return true;
  if (pathname.startsWith('/family/settings')) return true;
  if (/^\/family\/members\/.+/.test(pathname)) return true; // detail / edit / new
  return false;
}

function activeTab(pathname: string): Tab {
  if (pathname.startsWith('/family/members')) return 'family';
  if (pathname.startsWith('/family/enroll')) return 'bv';
  if (pathname.startsWith('/family/donate') && !pathname.startsWith('/family/donations')) return 'giving';
  return 'home';
}

export function MobileBottomNav() {
  const pathname = usePathname();
  if (shouldHide(pathname)) return null;
  const active = activeTab(pathname);

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
        background: 'var(--surface)', borderTop: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-around', padding: '10px 8px 16px',
      }}
    >
      {TABS.map((t) => {
        const Icon = SetuIcon[t.icon];
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            style={{
              background: 'transparent', border: 0, textDecoration: 'none',
              color: on ? 'var(--accent)' : 'var(--muted)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              fontSize: 11, fontWeight: 600,
            }}
          >
            <Icon/> {t.label}
          </Link>
        );
      })}
      <button
        onClick={() => { void signOut(); }}
        style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          color: 'var(--muted)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)',
        }}
      >
        <SetuIcon.user/> Sign out
      </button>
    </div>
  );
}
