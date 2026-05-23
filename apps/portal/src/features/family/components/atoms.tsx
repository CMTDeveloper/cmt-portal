'use client';

import type { ReactNode, CSSProperties } from 'react';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { signOut } from './sign-out-button';

// ─── CspRoot ─────────────────────────────────────────────────────────────────

interface CspRootProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function CspRoot({ children, style, className = '' }: CspRootProps) {
  return (
    <div className={`csp ${className}`} style={style}>
      {children}
    </div>
  );
}

// ─── StatusBar ───────────────────────────────────────────────────────────────

interface StatusBarProps {
  light?: boolean;
}

export function StatusBar({ light = false }: StatusBarProps) {
  return (
    <div style={{
      height: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 18px 0 22px', fontSize: 13, fontWeight: 600,
      color: light ? '#fff' : 'var(--ink)',
      fontFeatureSettings: '"tnum"', fontFamily: 'var(--body)',
    }}>
      <span>9:41</span>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
          <rect x="0" y="6" width="2.5" height="5" rx="0.5"/>
          <rect x="3.5" y="4" width="2.5" height="7" rx="0.5"/>
          <rect x="7" y="2" width="2.5" height="9" rx="0.5"/>
          <rect x="10.5" y="0" width="2.5" height="11" rx="0.5"/>
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M1 4.5a8 8 0 0 1 13 0"/>
          <path d="M3.5 6.5a5 5 0 0 1 8 0"/>
          <circle cx="7.5" cy="9" r="1" fill="currentColor"/>
        </svg>
        <svg width="24" height="11" viewBox="0 0 24 11" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="0.5" y="0.5" width="20" height="10" rx="2.5"/>
          <rect x="2" y="2" width="15" height="7" rx="1" fill="currentColor"/>
          <path d="M22 4v3" stroke="currentColor" strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  );
}

// ─── MobileFrame ─────────────────────────────────────────────────────────────

interface MobileFrameProps {
  children: ReactNode;
  w?: number;
  h?: number;
  light?: boolean;
}

export function MobileFrame({ children, w = 375, h = 760, light = false }: MobileFrameProps) {
  return (
    <div style={{
      width: w, height: h, background: 'var(--bg)',
      position: 'relative', overflow: 'hidden', fontFamily: 'var(--body)',
    }}>
      <StatusBar light={light}/>
      <div style={{ position: 'absolute', inset: '34px 0 0 0', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ─── StepHeader ──────────────────────────────────────────────────────────────

interface StepHeaderProps {
  step: number;
  of: number;
  label: string;
}

export function StepHeader({ step, of, label }: StepHeaderProps) {
  return (
    <div>
      <div className="row" style={{ gap: 4, marginBottom: 10 }}>
        {Array.from({ length: of }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < step ? 'var(--accent)' : 'var(--line)',
          }}/>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600 }}>
        Step {step} of {of} · {label}
      </div>
    </div>
  );
}

// ─── SectionLabel ────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginTop: 22, marginBottom: 10 }}>
      {children}
    </div>
  );
}

// ─── DetailGroup ─────────────────────────────────────────────────────────────

interface DetailGroupProps {
  rows: [string, ReactNode][];
}

export function DetailGroup({ rows }: DetailGroupProps) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ padding: '12px 14px', borderTop: i > 0 ? '1px solid var(--line)' : undefined, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 110, fontSize: 12, color: 'var(--muted)', flex: '0 0 auto' }}>{k}</div>
          <div style={{ fontSize: 13, color: 'var(--ink)', flex: 1, lineHeight: 1.4 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ─── PayMethod ───────────────────────────────────────────────────────────────

interface PayMethodProps {
  active?: boolean;
  label: string;
  sub: string;
  icon: ReactNode;
  onClick?: () => void;
}

export function PayMethod({ active, label, sub, icon, onClick }: PayMethodProps) {
  return (
    <button className="focus-ring" onClick={onClick} style={{
      width: '100%', padding: 14, background: 'var(--surface)',
      border: '1px solid', borderColor: active ? 'var(--accent)' : 'var(--line2)',
      boxShadow: active ? '0 0 0 3px var(--accentSoft)' : 'none',
      borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg)', display: 'grid', placeItems: 'center', color: 'var(--body-text)' }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
      </div>
      <div style={{
        width: 20, height: 20, borderRadius: '50%', border: '2px solid',
        borderColor: active ? 'var(--accent)' : 'var(--line2)',
        background: active ? 'var(--accent)' : 'transparent',
        display: 'grid', placeItems: 'center',
      }}>
        {active && <div style={{ width: 8, height: 8, background: '#fff', borderRadius: 99 }}/>}
      </div>
    </button>
  );
}

// ─── AddedMemberRow ───────────────────────────────────────────────────────────

interface AddedMemberRowProps {
  name: string;
  type: string;
}

export function AddedMemberRow({ name, type }: AddedMemberRowProps) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <div className="row" style={{ gap: 10 }}>
        <SetuAvatar name={name} size={32}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{type}</div>
        </div>
        <button className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--muted)', padding: 4 }}>
          <SetuIcon.edit/>
        </button>
      </div>
    </div>
  );
}

// ─── AllergyCallout ───────────────────────────────────────────────────────────

interface AllergyCalloutProps {
  severity?: string;
  summary: string;
  detail: string;
}

export function AllergyCallout({ severity = 'severe', summary, detail }: AllergyCalloutProps) {
  return (
    <div style={{
      padding: 16, background: '#fff3ec', border: '2px solid var(--err)', borderRadius: 'var(--radius)',
      marginBottom: 16,
    }}>
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--err)', color: '#fff', display: 'grid', placeItems: 'center' }}>
          <SetuIcon.warn color="#fff"/>
        </div>
        <strong style={{ fontSize: 13, color: 'var(--err)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Food allergies</strong>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{summary} · {severity}</div>
      <div style={{ fontSize: 12, color: 'var(--body-text)' }}>{detail}</div>
    </div>
  );
}

// ─── DesktopSidebar ───────────────────────────────────────────────────────────

type SidebarTab = 'home' | 'family' | 'bv' | 'giving' | 'receipts';

interface DesktopSidebarProps {
  active: SidebarTab;
  role?: 'family' | 'welcome-team';
  displayName?: string | undefined;
  subtitle?: string | undefined;
  showSignOut?: boolean;
}

const FAMILY_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string][] = [
  ['home',     'Home',       'home',    '/family'],
  ['family',   'My family',  'people',  '/family/members'],
  ['bv',       'Bala Vihar', 'calendar','/family/enroll'],
  ['giving',   'Giving',     'heart',   '/family/donate'],
  ['receipts', 'Receipts',   'receipt', '/family/donations'],
];

const WELCOME_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string, boolean?][] = [
  ['home', 'Search',           'search',  '/welcome'],
  ['family', 'Pending',        'people',  '/welcome', true],
  ['bv',     'Donation periods','calendar','/welcome', true],
];

export function DesktopSidebar({ active, role = 'family', displayName, subtitle, showSignOut }: DesktopSidebarProps) {
  const navItems = role === 'welcome-team' ? WELCOME_NAV_ITEMS : FAMILY_NAV_ITEMS;
  // displayName can be passed in as " " (just a space) by callers that join an
  // empty firstName + empty lastName from a lazy-migrated placeholder member.
  // Trim and fall back to a neutral label so the sidebar never shows a blank
  // avatar with a stray member id underneath.
  const trimmed = (displayName ?? '').trim();
  const name = trimmed || (role === 'welcome-team' ? 'Welcome team' : 'Family member');

  return (
    <aside style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)', padding: '22px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 28 }}><SetuLogo size={20}/></div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
        {navItems.map(([id, label, iconKey, href, disabled]) => {
          const Icon = SetuIcon[iconKey];
          const a = id === active && !disabled;
          return disabled ? (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 'var(--radiusSm)',
              color: 'var(--muted)', fontWeight: 500, opacity: 0.5, cursor: 'not-allowed',
            }}>
              <Icon/> {label}
              <span style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Soon</span>
            </div>
          ) : (
            <Link key={id} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 'var(--radiusSm)',
              background: a ? 'var(--accentSoft)' : 'transparent',
              color: a ? 'var(--accentDeep)' : 'var(--body-text)',
              fontWeight: a ? 600 : 500, textDecoration: 'none',
            }}>
              <Icon/> {label}
            </Link>
          );
        })}
      </nav>
      <div style={{ marginTop: 'auto', padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 10 }}>
          <SetuAvatar name={name} size={32}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            {subtitle && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
          </div>
        </div>
        {showSignOut && (
          <button
            onClick={() => { void signOut(); }}
            style={{
              marginTop: 10, width: '100%', background: 'transparent', border: '1px solid var(--line2)',
              borderRadius: 'var(--radiusSm)', padding: '6px 10px', fontSize: 12, color: 'var(--muted)',
              cursor: 'pointer', fontFamily: 'var(--body)', fontWeight: 500,
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}

// ─── YearTile ─────────────────────────────────────────────────────────────────

interface YearTileProps {
  year: string;
  total: number;
  count: number;
  active?: boolean;
}

export function YearTile({ year, total, count, active }: YearTileProps) {
  return (
    <div className="card" style={{
      padding: 18,
      background: active ? 'var(--accent)' : 'var(--surface)',
      color: active ? '#fff' : 'var(--ink)',
      border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
    }}>
      <div style={{ fontSize: 11, opacity: active ? .8 : 1, color: active ? '#fff' : 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>Year</div>
      <div className="between" style={{ alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 28 }}>{year}</span>
        <span style={{ fontFamily: 'var(--display)', fontSize: 22 }}>${total}</span>
      </div>
      <div style={{ fontSize: 11, marginTop: 6, opacity: active ? .8 : 1, color: active ? '#fff' : 'var(--muted)' }}>
        {count} donation{count !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  sub: string;
  tone?: 'ok' | 'warn';
}

export function MetricCard({ label, value, sub, tone }: MetricCardProps) {
  const dot = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted)';
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: dot }}/>
        <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ─── Stat ─────────────────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: string;
  sub?: string;
}

export function Stat({ label, value, sub }: StatProps) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 22, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── FieldError ───────────────────────────────────────────────────────────────

interface FieldErrorProps {
  message?: string | undefined;
}

export function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <span data-testid="field-error" style={{ fontSize: 11, color: 'var(--err)', marginTop: 4, display: 'block' }}>
      {message}
    </span>
  );
}
