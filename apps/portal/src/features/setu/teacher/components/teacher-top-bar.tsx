'use client';

import Link from 'next/link';
import { SetuLogo } from '@cmt/ui';
import { signOut } from '@/features/family/components/sign-out-button';

// Authenticated chrome for the teacher area. A single sticky top app-bar
// (no sidebar — the teacher surface is shallow: classes → attendance →
// visitors, each with its own in-page back link). Sticky-top is deliberate so
// it never collides with the attendance screen's *fixed*-bottom Save bar.
//
// Reuses the project SetuLogo and the same signOut() handler the family /
// welcome sidebars use (POST /api/setu/auth/signout → redirect to /sign-in).
// All colors come from the .csp-scoped --setu-* token aliases; the teacher
// layout already wraps this in <CspRoot>, so the tokens resolve.

const signOutBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--line2)',
  borderRadius: 'var(--radiusSm)',
  padding: '7px 12px',
  fontSize: 13,
  color: 'var(--body-text)',
  fontFamily: 'var(--body)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  minHeight: 36,
};

const myFamilyLinkStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--body-text)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

export function TeacherTopBar() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        // Opaque fallback first, then a translucent frosted layer where
        // color-mix + backdrop-filter are supported (all current mobile
        // browsers). The fallback keeps the bar readable everywhere.
        background: 'var(--surface)',
        backgroundColor: 'color-mix(in srgb, var(--surface) 88%, transparent)',
        backdropFilter: 'saturate(180%) blur(10px)',
        WebkitBackdropFilter: 'saturate(180%) blur(10px)',
        borderBottom: '1px solid var(--line)',
        boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div
        className="between"
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '12px 20px',
          gap: 12,
        }}
      >
        {/* Left: brand mark + teacher eyebrow */}
        <Link
          href="/teacher"
          aria-label="Teacher home"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}
        >
          <SetuLogo size={18} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'var(--accentDeep)',
              background: 'var(--accentSoft)',
              padding: '3px 8px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
            }}
          >
            Teacher
          </span>
        </Link>

        {/* Right: cross-link to the family surface + sign out. Both stay
            visible at every width — the labels are short and the flex row
            shrinks gracefully (minWidth:0 on the brand link absorbs slack). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Link href="/family" style={{ ...myFamilyLinkStyle, padding: '7px 10px', borderRadius: 'var(--radiusSm)' }}>
            My&nbsp;family
          </Link>
          <span aria-hidden style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />
          <button type="button" onClick={() => { void signOut(); }} className="focus-ring" style={signOutBtnStyle}>
            Sign&nbsp;out
          </button>
        </div>
      </div>
    </header>
  );
}
