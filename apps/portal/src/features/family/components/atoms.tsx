'use client';

import type { ReactNode, CSSProperties } from 'react';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { recordedAllergy } from '@cmt/shared-domain';

export { DesktopSidebar } from './desktop-sidebar';

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
  /**
   * The row's trailing control. Supply one and it REPLACES the decorative
   * pencil - it does not sit beside it.
   *
   * The register form used to absolutely-position its "Remove" button over this
   * row (`top:12 right:12`), which landed it directly on top of the pencil:
   * reported 2026-07-29 as "the edit and remove overlapping". The pencil is the
   * one at fault - it has never had an `onClick` and exists only in the
   * flag-off prototype, so a real caller's control must take its place rather
   * than be layered over a button that does nothing.
   */
  action?: React.ReactNode;
}

export function AddedMemberRow({ name, type, action }: AddedMemberRowProps) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <div className="row" style={{ gap: 10 }}>
        <SetuAvatar name={name} size={32}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{type}</div>
        </div>
        {action ?? (
          <button className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--muted)', padding: 4 }}>
            <SetuIcon.edit/>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── AllergyCallout ───────────────────────────────────────────────────────────

interface AllergyCalloutProps {
  /**
   * Optional, and omitted by every caller reading a real member: the portal
   * collects allergy TEXT and has never collected a severity, so printing
   * "· severe" after it asserted something no one recorded. Only the mock
   * prototype data, which carries a real severity field, still passes it.
   */
  severity?: string;
  summary: string;
  detail: string;
}

/**
 * The whole allergy story for one member, in the three states it actually has.
 *
 *   a real allergy      → the red callout
 *   "no known allergies" → a plain line confirming we asked and they answered
 *   nothing recorded    → nothing
 *
 * The middle state is why this component exists. `NO_ALLERGIES` writes the
 * literal 'None', and rendering that through the callout produced a severe red
 * allergy warning for 104 of the 105 production members holding any value
 * (2026-08-05) against ONE real allergy. Silence would have been the other
 * wrong answer for a FAMILY looking at their own child - it reads as "we never
 * asked" and invites them to type it in again.
 *
 * Use this rather than `AllergyCallout` directly on any surface that shows one
 * member's full record - which includes `/welcome/family/{fid}/members/{mid}`,
 * so staff see the "No known allergies" line too. That is fine and arguably
 * better; it is only the LIST surfaces (the teacher attendance marker, the
 * family's own member cards) that stay silent, because there the absence of a
 * marker is the answer and a line per member would be noise. Those null the
 * sentinel in their data layer instead - see `teacher/roster.ts` and
 * `member-display.ts`.
 */
export function AllergyBlock({ value }: { value: string | null }) {
  const allergy = recordedAllergy(value);
  if (allergy) return <AllergyCallout summary={allergy} detail="Please inform class teacher."/>;
  if (recordedAnswer(value)) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        No known allergies
      </div>
    );
  }
  return null;
}

/** Whether the family answered the allergy question at all (either way). */
function recordedAnswer(value: string | null): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function AllergyCallout({ severity, summary, detail }: AllergyCalloutProps) {
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
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{summary}{severity ? ` · ${severity}` : ''}</div>
      <div style={{ fontSize: 12, color: 'var(--body-text)' }}>{detail}</div>
    </div>
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
  tone?: 'ok' | 'warn' | 'err';
}

export function MetricCard({ label, value, sub, tone }: MetricCardProps) {
  const toneColor =
    tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'err' ? 'var(--err)' : 'var(--ink)';
  const dot = tone ? toneColor : 'var(--muted)';
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: dot }}/>
        <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: tone ? toneColor : 'var(--ink)' }}>{value}</div>
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

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 24, minHeight: 120, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: '40%', height: 14, borderRadius: 6, background: 'var(--surface2)' }}/>
      <div style={{ width: '70%', height: 10, borderRadius: 6, background: 'var(--surface2)', opacity: 0.6 }}/>
      <div style={{ width: '55%', height: 10, borderRadius: 6, background: 'var(--surface2)', opacity: 0.4 }}/>
    </div>
  );
}
