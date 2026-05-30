'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

// Bottom nav for the welcome-team section (/welcome). Shown on every welcome
// page, including the drill-down detail pages (family detail, single-level
// roster) which also keep their own back arrow.
function isSearchActive(pathname: string): boolean {
  return !pathname.startsWith('/welcome/levels');
}

export function WelcomeMobileNav({ isAdmin = false, hasFamily = false }: { isAdmin?: boolean; hasFamily?: boolean }) {
  const pathname = usePathname();
  const searchActive = isSearchActive(pathname);

  const itemStyle = (on: boolean): React.CSSProperties => ({
    background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'none',
    color: on ? 'var(--accent)' : 'var(--muted)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)',
  });

  return (
    <div
      className="csp"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
        background: 'var(--surface)', borderTop: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-around', padding: '10px 8px 16px',
      }}
    >
      <Link href="/welcome" style={itemStyle(searchActive)}>
        <SetuIcon.search /> Search
      </Link>
      <Link href="/welcome/levels" style={itemStyle(!searchActive)}>
        <SetuIcon.people /> Levels
      </Link>
      {isAdmin ? (
        <Link href="/admin" style={itemStyle(false)}>
          <SetuIcon.shield /> Admin
        </Link>
      ) : hasFamily ? (
        <Link href="/family" style={itemStyle(false)}>
          <SetuIcon.home /> My family
        </Link>
      ) : null}
      <button onClick={() => { void signOut(); }} style={itemStyle(false)}>
        <SetuIcon.user /> Sign out
      </button>
    </div>
  );
}
