'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

// Bottom nav for the welcome-team section (/welcome). Shown on every welcome
// page, including the drill-down detail pages (family detail, single-level
// roster) which also keep their own back arrow.
// Roster is the DEFAULT tab, so every sibling section must be excluded here by
// name - a new /welcome/* page that is not listed silently lights up Roster.
function isRosterActive(pathname: string): boolean {
  return !pathname.startsWith('/welcome/levels') && !pathname.startsWith('/welcome/seva') && !pathname.startsWith('/welcome/reports') && !pathname.startsWith('/welcome/prasad') && !pathname.startsWith('/welcome/visitors');
}

export function WelcomeMobileNav({ isAdmin = false, hasFamily = false, showTeacher = false, role = 'welcome-team' }: { isAdmin?: boolean; hasFamily?: boolean; showTeacher?: boolean; role?: 'welcome-team' | 'coordinator' }) {
  // Levels / Seva / Prasad / Reports are welcome-team-only per spec 3.1, so for
  // a coordinator each would 302 to /sign-in on tap. The Admin link below is
  // denied too, but it is already gated on isAdmin, which a coordinator is not.
  const welcomeOnly = role !== 'coordinator';
  const pathname = usePathname();
  const rosterActive = isRosterActive(pathname);
  const reportsActive = pathname.startsWith('/welcome/reports');
  const prasadActive = pathname.startsWith('/welcome/prasad');

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
      <Link href="/welcome/roster" style={itemStyle(rosterActive)}>
        <SetuIcon.search /> Roster
      </Link>
      {welcomeOnly && (
        <>
          <Link href="/welcome/levels" style={itemStyle(pathname.startsWith('/welcome/levels'))}>
            <SetuIcon.people /> Levels
          </Link>
          <Link href="/welcome/seva" style={itemStyle(pathname.startsWith('/welcome/seva'))}>
            <SetuIcon.heart /> Seva
          </Link>
          <Link href="/welcome/visitors" style={itemStyle(pathname.startsWith('/welcome/visitors'))}>
            <SetuIcon.bell /> Visitors
          </Link>
          <Link href="/welcome/prasad" style={itemStyle(prasadActive)}>
            <SetuIcon.bell /> Prasad
          </Link>
          <Link href="/welcome/reports" style={itemStyle(reportsActive)}>
            <SetuIcon.info /> Reports
          </Link>
        </>
      )}
      {showTeacher && (
        <Link href="/teacher" style={itemStyle(false)}>
          <SetuIcon.people /> Teacher
        </Link>
      )}
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
