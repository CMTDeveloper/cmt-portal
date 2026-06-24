'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SetuLogo, SetuIcon } from '@cmt/ui';
import { LOCATIONS } from '@cmt/shared-domain/setu';
import type { Location, RosterFamilyRow, RosterPayment } from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { searchFamiliesClient } from '@/features/setu/search/search-families-client';
import type { FamilySearchHit } from '@/features/setu/search/search-families-client';
import { fetchRosterClient } from './roster-client';
import { RosterExportButton } from './roster-export-button';
import { MigrationStrip } from './migration-strip';

const PAGE_SIZE = 50;

// Known program filter chips. programKey is a free slug (no exported label map),
// so we keep a small map for the common ones and title-case the rest.
const KNOWN_PROGRAMS = ['bala-vihar', 'tabla', 'vocal', 'yuva-kendra'] as const;
const PROGRAM_LABELS: Record<string, string> = {
  'bala-vihar': 'Bala Vihar',
  tabla: 'Tabla',
  vocal: 'Vocal',
  'yuva-kendra': 'Yuva Kendra',
};
function programLabel(key: string): string {
  return PROGRAM_LABELS[key] ?? key.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

// ── Payment chip tones ────────────────────────────────────────────────────────
const PAYMENT_STYLE: Record<RosterPayment, { bg: string; fg: string; label: string }> = {
  paid: { bg: 'var(--accentSoft)', fg: 'var(--ok)', label: 'Paid' },
  outstanding: { bg: 'var(--accentSoft)', fg: 'var(--warn)', label: 'Outstanding' },
  unknown: { bg: 'var(--surface2)', fg: 'var(--muted)', label: 'Unknown' },
};

function PaymentChip({ payment }: { payment: RosterPayment }) {
  const s = PAYMENT_STYLE[payment];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 99,
        background: s.bg, color: s.fg, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />
      {s.label}
    </span>
  );
}

// ── Filter chip ─────────────────────────────────────────────────────────────
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring"
      aria-pressed={active}
      style={{
        minHeight: 44, padding: '0 14px',
        fontSize: 13, fontWeight: 600, lineHeight: 1,
        borderRadius: 99, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid',
        borderColor: active ? 'var(--accent)' : 'var(--line)',
        background: active ? 'var(--accent)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--body-text)',
        transition: 'background .12s, border-color .12s, color .12s',
      }}
    >
      {children}
    </button>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────
const cardStyle = {
  display: 'block', padding: 16,
  background: 'var(--surface)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', textDecoration: 'none', color: 'inherit',
} as const;

function RosterFamilyCard({ row }: { row: RosterFamilyRow }) {
  return (
    <Link key={row.fid} href={`/welcome/family/${row.fid}`} className="focus-ring" style={cardStyle}>
      <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{row.name} Family</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            FID {row.fid}{row.legacyFid ? ` · Legacy ${row.legacyFid}` : ''} · {row.location}
          </div>
          {row.programs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {row.programs.map((p) => (
                <span
                  key={p}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 99,
                    background: 'var(--surface2)', color: 'var(--body-text)', border: '1px solid var(--line)',
                  }}
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: '0 0 auto' }}>
          <PaymentChip payment={row.payment} />
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {row.memberCount} member{row.memberCount !== 1 ? 's' : ''}
            <SetuIcon.chevron color="var(--muted)" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function SearchHitCard({ hit }: { hit: FamilySearchHit }) {
  return (
    <Link key={hit.fid} href={`/welcome/family/${hit.fid}`} className="focus-ring" style={cardStyle}>
      <div className="between">
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{hit.name} Family</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            FID {hit.fid}{hit.legacyFid ? ` · Legacy ${hit.legacyFid}` : ''} · {hit.location}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{hit.memberCount} member{hit.memberCount !== 1 ? 's' : ''}</div>
          <SetuIcon.chevron color="var(--muted)" />
        </div>
      </div>
    </Link>
  );
}

// ── Core content (rendered into both mobile + desktop branches) ────────────────
function RosterContent({ year }: { year?: string }) {
  // Filters
  const [location, setLocation] = useState<Location | null>(null);
  const [program, setProgram] = useState<string | null>(null);

  // Browse state
  const [rows, setRows] = useState<RosterFamilyRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [browseError, setBrowseError] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FamilySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const searchActive = query.trim().length > 0;

  // Browse fetch (page 1) — refires when a filter changes.
  const loadBrowse = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseError(false);
    try {
      const res = await fetchRosterClient({
        limit: PAGE_SIZE,
        ...(location ? { location } : {}),
        ...(program ? { program } : {}),
        ...(year ? { year } : {}),
      });
      setRows(res.families);
      setNextCursor(res.nextCursor);
      setTotal(res.total);
    } catch {
      setBrowseError(true);
      setRows([]);
      setNextCursor(null);
      setTotal(null);
    } finally {
      setBrowseLoading(false);
    }
  }, [location, program, year]);

  useEffect(() => {
    void loadBrowse();
  }, [loadBrowse]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchRosterClient({
        limit: PAGE_SIZE,
        cursor: nextCursor,
        ...(location ? { location } : {}),
        ...(program ? { program } : {}),
        ...(year ? { year } : {}),
      });
      setRows((prev) => [...prev, ...res.families]);
      setNextCursor(res.nextCursor);
    } catch {
      setBrowseError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  // Search-as-filter — debounced, monotonic stale-sequence guard (same as welcome-search).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setSearched(false);
      setSearchError(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const mySeq = ++seqRef.current;
      setSearching(true);
      setSearchError(false);
      try {
        const results = await searchFamiliesClient(trimmed);
        if (mySeq !== seqRef.current) return;
        setHits(results);
        setSearched(true);
      } catch {
        if (mySeq !== seqRef.current) return;
        setSearchError(true);
        setHits([]);
        setSearched(true);
      } finally {
        if (mySeq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <MigrationStrip />

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', display: 'inline-flex' }}>
          <SetuIcon.search />
        </div>
        <input
          data-testid="roster-search-input"
          type="search"
          placeholder="Search name, email, phone, or FID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', minHeight: 44, padding: '0 14px 0 40px',
            fontSize: 15, border: '1px solid var(--line)',
            borderRadius: 'var(--radius)', background: 'var(--surface)',
            color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
          }}
        />
        {searching && (
          <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12 }}>
            Searching…
          </div>
        )}
      </div>

      {/* Filters — hidden while searching (search ignores filters by design). */}
      {!searchActive && (
        <div className="col" style={{ gap: 10 }}>
          <FilterRow label="Location">
            <FilterChip active={location === null} onClick={() => setLocation(null)}>All</FilterChip>
            {LOCATIONS.map((loc) => (
              <FilterChip key={loc} active={location === loc} onClick={() => setLocation(loc)}>{loc}</FilterChip>
            ))}
          </FilterRow>
          <FilterRow label="Program">
            <FilterChip active={program === null} onClick={() => setProgram(null)}>All</FilterChip>
            {KNOWN_PROGRAMS.map((key) => (
              <FilterChip key={key} active={program === key} onClick={() => setProgram(key)}>{programLabel(key)}</FilterChip>
            ))}
          </FilterRow>
        </div>
      )}

      {/* Count + export */}
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontFeatureSettings: '"tnum"' }}>
          {searchActive
            ? (searched && !searching ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : ' ')
            : (total !== null ? `${total.toLocaleString()} famil${total === 1 ? 'y' : 'ies'}` : ' ')}
        </span>
        <RosterExportButton location={location} program={program} {...(year ? { year } : {})} />
      </div>

      {/* Results */}
      <div className="col" style={{ gap: 8 }} data-testid="roster-results">
        {searchActive ? (
          <>
            {searchError && <Notice tone="err">Search failed. Please try again.</Notice>}
            {searched && !searching && !searchError && hits.length === 0 && (
              <Notice tone="muted">No matching families found.</Notice>
            )}
            {hits.map((hit) => <SearchHitCard key={hit.fid} hit={hit} />)}
          </>
        ) : (
          <>
            {browseError && <Notice tone="err">Couldn’t load the roster. Please try again.</Notice>}
            {browseLoading && rows.length === 0 && !browseError && (
              <Notice tone="muted">Loading families…</Notice>
            )}
            {!browseLoading && !browseError && rows.length === 0 && (
              <Notice tone="muted">No families match these filters.</Notice>
            )}
            {rows.map((row) => <RosterFamilyCard key={row.fid} row={row} />)}
            {nextCursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="focus-ring"
                style={{
                  minHeight: 44, marginTop: 4,
                  fontSize: 13, fontWeight: 600,
                  background: 'var(--surface)', color: 'var(--accentDeep)',
                  border: '1px solid var(--line)', borderRadius: 'var(--radius)',
                  cursor: loadingMore ? 'default' : 'pointer',
                }}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'muted' | 'err'; children: React.ReactNode }) {
  if (tone === 'err') {
    return (
      <div style={{ padding: '10px 14px', background: 'var(--accentSoft)', border: '1px solid var(--err)', borderRadius: 'var(--radiusSm)', fontSize: 13, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <SetuIcon.warn color="var(--err)" /> {children}
      </div>
    );
  }
  return <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', margin: '24px 0' }}>{children}</p>;
}

export function RosterBrowser({ year }: { year?: string }) {
  return (
    <>
      {/* Mobile — own CspRoot + 90px bottom padding for the fixed WelcomeMobileNav. */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div style={{ marginBottom: 20 }}>
              <SetuLogo size={18} />
            </div>
            <header style={{ marginBottom: 18 }}>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em' }}>Roster</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                Browse every family, filter by location or program, and search by name, email, phone, or FID.
              </p>
            </header>
            <RosterContent {...(year ? { year } : {})} />
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns the sidebar + main wrapper. */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Roster</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Browse every family, filter by location or program, and search by name, email, phone, or FID.
          </p>
        </header>
        <div style={{ maxWidth: 720 }}>
          <RosterContent {...(year ? { year } : {})} />
        </div>
      </div>
    </>
  );
}
