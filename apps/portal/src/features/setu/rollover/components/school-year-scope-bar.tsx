'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { resolveViewYear, type SchoolYearStatus } from '@/features/setu/rollover/view-year';

/**
 * Global school-year scope bar (design "Option A"). A persistent strip that owns
 * the top of every admin / welcome screen and makes the operating year a
 * primary, always-visible control.
 *
 *  - Live year   → calm peach strip ("Operating in 2025–26 · LIVE").
 *  - Non-live    → the WHOLE strip turns amber ("You're viewing 2024–25 …") so an
 *                  admin can never miss that their edits won't touch the live
 *                  portal — school year scopes destructive edits, so the warning
 *                  stays in their face. This is the safety payoff over a sidebar pill.
 *
 * It carries `className="csp"` so the Setu brand tokens resolve even if rendered
 * outside a CspRoot (the soft status tints `--setu-ok-soft` / `--setu-warn-soft`
 * are :root tokens; the rest are `.csp` aliases — see packages/ui/src/styles).
 *
 * The switcher is a `?year=` carrier: it pushes the same path with the new year
 * (or drops the param for the live year), matching every year-scoped read.
 */
interface Props {
  years: string[];
  liveYear: string;
  /** Admins reach /admin/school-year; welcome-team can switch/view but not manage. */
  canManage?: boolean;
}

const MANAGE_HREF = '/admin/school-year';

type Tone = 'live' | 'draft' | 'archived';
function lifecycle(status: SchoolYearStatus): { label: string; tone: Tone } {
  if (status === 'live') return { label: 'Live', tone: 'live' };
  if (status === 'preparing') return { label: 'Draft', tone: 'draft' };
  if (status === 'past') return { label: 'Archived', tone: 'archived' };
  const _exhaustive: never = status; // a new status must be handled explicitly
  return _exhaustive;
}

const BADGE_BG: Record<Tone, React.CSSProperties> = {
  live: { background: 'var(--setu-ok-soft)', color: 'var(--ok)' },
  draft: { background: 'var(--surface2)', color: 'var(--muted)' },
  archived: { background: 'var(--setu-warn-soft)', color: 'var(--warn)' },
};

function StatusBadge({ status }: { status: SchoolYearStatus }) {
  const { label, tone } = lifecycle(status);
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em',
        padding: '2px 8px', borderRadius: 999, ...BADGE_BG[tone],
      }}
    >
      {tone === 'live' && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
      )}
      {label.toUpperCase()}
    </span>
  );
}

export function SchoolYearScopeBar({ years, liveYear, canManage = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { year: selected, status } = resolveViewYear(years, liveYear, params.get('year'));
  const isLive = status === 'live';

  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = useCallback(
    (year: string) => {
      setOpen(false);
      const next = new URLSearchParams(params.toString());
      if (year === liveYear) next.delete('year');
      else next.set('year', year);
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, liveYear, pathname, router],
  );

  // Live pinned first, then the remaining years newest → oldest.
  const ordered = [liveYear, ...years.filter((y) => y !== liveYear).sort().reverse()];

  const trailCopy =
    status === 'preparing'
      ? "changes here are staged for next year and won't go live until it's activated."
      : "this year is read-only; changes won't affect the live portal.";

  // A paler-than-badge peach so the white pill + LIVE badge read as figure
  // against the calm strip (the deeper --accentSoft is reserved for the badge
  // fills + selected-row highlight).
  const barBg = isLive ? 'color-mix(in srgb, var(--accentSoft) 45%, var(--surface))' : 'var(--setu-warn-soft)';
  const barBorder = isLive
    ? 'color-mix(in srgb, var(--accentDeep) 18%, var(--accentSoft))'
    : 'color-mix(in srgb, var(--warn) 32%, var(--setu-warn-soft))';
  const leadColor = isLive ? 'var(--muted)' : 'var(--warn)';
  const triggerBorder = isLive
    ? 'color-mix(in srgb, var(--accent) 32%, var(--surface))'
    : 'color-mix(in srgb, var(--warn) 38%, var(--surface))';

  return (
    <div
      className="csp"
      data-testid="school-year-scope-bar"
      data-status={status}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        padding: '10px 16px', marginBottom: 20,
        background: barBg, border: `1px solid ${barBorder}`, borderRadius: 'var(--radiusSm)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: leadColor }}>
        {isLive ? (
          <SetuIcon.calendar width={17} height={17} style={{ color: 'var(--accent)' }} />
        ) : (
          <SetuIcon.warn width={18} height={18} style={{ color: 'var(--warn)' }} />
        )}
        {isLive ? 'Operating in' : "You're viewing"}
      </span>

      <div ref={popRef} style={{ position: 'relative' }}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`School year ${selected}, ${lifecycle(status).label}. Change school year`}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 9,
            background: 'var(--surface)', border: `1px solid ${triggerBorder}`,
            borderRadius: 10, padding: '7px 12px', cursor: 'pointer',
            fontFamily: 'var(--body)', color: 'var(--ink)',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700 }}>{selected}</span>
          <StatusBadge status={status} />
          <SetuIcon.chevron
            width={15}
            height={15}
            style={{ color: 'var(--muted)', transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .12s' }}
          />
        </button>

        {open && (
          <div
            role="listbox"
            aria-label="School year"
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40,
              minWidth: 264, background: 'var(--surface)',
              border: '1px solid color-mix(in srgb, var(--accent) 26%, var(--surface))',
              borderRadius: 12, boxShadow: 'var(--setu-elev-3)', overflow: 'hidden',
            }}
          >
            {ordered.map((y, i) => {
              const ys = resolveViewYear(years, liveYear, y === liveYear ? null : y).status;
              const isSel = y === selected;
              return (
                <button
                  key={y}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => go(y)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    width: '100%', textAlign: 'left', padding: '11px 14px',
                    background: isSel ? 'var(--accentSoft)' : 'var(--surface)',
                    border: 0, borderTop: i === 0 ? 0 : '1px solid var(--line)', cursor: 'pointer',
                    fontFamily: 'var(--body)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: ys === 'past' ? 'var(--muted)' : 'var(--ink)' }}>{y}</span>
                    <StatusBadge status={ys} />
                  </span>
                  {isSel && <SetuIcon.check width={16} height={16} style={{ color: 'var(--accentDeep)' }} />}
                </button>
              );
            })}
            {canManage && (
              <Link
                href={MANAGE_HREF}
                onClick={() => setOpen(false)}
                style={{
                  display: 'block', padding: '11px 14px',
                  borderTop: '1px solid color-mix(in srgb, var(--accent) 22%, var(--surface))',
                  background: 'var(--bg)', fontSize: 13, fontWeight: 600,
                  color: 'var(--accentDeep)', textDecoration: 'none',
                }}
              >
                Manage school years →
              </Link>
            )}
          </div>
        )}
      </div>

      {!isLive && (
        <span style={{ fontSize: 13, color: 'var(--warn)' }}>— {trailCopy}</span>
      )}

      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 16 }}>
        {!isLive ? (
          <button
            type="button"
            onClick={() => go(liveYear)}
            style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              fontFamily: 'var(--body)', fontSize: 13, fontWeight: 700, color: 'var(--accentDeep)',
            }}
          >
            Switch to {liveYear} (Live) →
          </button>
        ) : (
          canManage && (
            <Link href={MANAGE_HREF} style={{ fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)', textDecoration: 'none' }}>
              Manage school years →
            </Link>
          )
        )}
      </span>
    </div>
  );
}
