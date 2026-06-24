'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

interface Props { years: string[]; liveYear: string; }

/** Admin/welcome year selector. Reads the current ?year= (defaults to live) and
 *  pushes the same path with the new year. Shows a "not live" / "read-only" strip
 *  when the selection isn't the live year. */
export function SchoolYearSwitcher({ years, liveYear }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get('year');
  const selected = raw && years.includes(raw) ? raw : liveYear;
  const status = selected === liveYear ? 'live' : selected < liveYear ? 'past' : 'preparing';

  function onChange(year: string) {
    const next = new URLSearchParams(params.toString());
    if (year === liveYear) next.delete('year');
    else next.set('year', year);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <span className="csp" style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
        <label htmlFor="sy-switch" style={{ color: 'var(--muted)' }}>School year</label>
        <select
          id="sy-switch"
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px' }}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}{y === liveYear ? ' · Live' : ''}</option>
          ))}
        </select>
      </span>
      {status !== 'live' && (
        <span style={{ fontSize: 11, fontWeight: 600, color: status === 'preparing' ? 'var(--accentDeep)' : 'var(--muted)' }}>
          {status === 'preparing' ? `Preparing ${selected} — not live yet` : `Past year — read-only`}
        </span>
      )}
    </span>
  );
}
