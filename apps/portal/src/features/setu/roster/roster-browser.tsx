'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { SetuLogo, SetuIcon } from '@cmt/ui';
import { displayFid, ROSTER_PAYMENTS } from '@cmt/shared-domain/setu';
import type {
  RosterReportRow, RosterReportFilters, RosterReportSummary, RosterPayment,
} from '@cmt/shared-domain/setu';
import {
  matchesRosterFilters, summarizeRoster, deriveLevelOptions, deriveGradeOptions,
} from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { searchFamiliesClient } from '@/features/setu/search/search-families-client';
import type { FamilySearchHit } from '@/features/setu/search/search-families-client';
import { fetchRosterReportClient } from './roster-client';
import { RosterExportButton } from './roster-export-button';
import { MigrationStrip } from './migration-strip';

const INITIAL_SHOWN = 50;

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

// ── Cards ─────────────────────────────────────────────────────────────────────
const cardStyle = {
  display: 'block', padding: 16,
  background: 'var(--surface)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', textDecoration: 'none', color: 'inherit',
} as const;

function RosterFamilyCard({ row }: { row: RosterReportRow }) {
  return (
    <Link key={row.fid} href={`/welcome/family/${row.fid}`} className="focus-ring" style={cardStyle}>
      <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{row.parentName}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            FID {displayFid(row)}{row.legacyFid ? ` · Legacy ${row.legacyFid}` : ''} · {row.location}
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
          <div style={{ fontSize: 15, fontWeight: 600 }}>{hit.parentName}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            FID {displayFid(hit)}{hit.legacyFid ? ` · Legacy ${hit.legacyFid}` : ''} · {hit.location}
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

function SummaryStrip({ summary }: { summary: RosterReportSummary }) {
  return (
    <div
      className="card"
      style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}
      data-testid="roster-summary"
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        {summary.familyCount.toLocaleString()} famil{summary.familyCount === 1 ? 'y' : 'ies'}
        {' · '}
        {summary.childCount.toLocaleString()} Bala Vihar child{summary.childCount === 1 ? '' : 'ren'}
      </div>
      {summary.byLevel.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--body-text)' }}>
          <span style={{ color: 'var(--muted)', fontWeight: 600 }}>By level:</span>
          {summary.byLevel.map((b) => (
            <span key={b.levelName} style={{ fontFeatureSettings: '"tnum"' }}>{b.levelName} · {b.childCount}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--body-text)' }}>
        <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Payment:</span>
        <span style={{ fontFeatureSettings: '"tnum"' }}>Paid · {summary.byPayment.paid}</span>
        <span style={{ fontFeatureSettings: '"tnum"' }}>Outstanding · {summary.byPayment.outstanding}</span>
        <span style={{ fontFeatureSettings: '"tnum"' }}>Unknown · {summary.byPayment.unknown}</span>
      </div>
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

// ── Core content (rendered into both mobile + desktop branches) ────────────────
function RosterContent({ year, locationOptions }: { year?: string; locationOptions: string[] }) {
  // Dataset (loaded once)
  const [rows, setRows] = useState<RosterReportRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Filters
  const [location, setLocation] = useState<string | null>(null);
  const [program, setProgram] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [payment, setPayment] = useState<RosterPayment | null>(null);
  const [shown, setShown] = useState(INITIAL_SHOWN);

  // Search (unchanged behavior)
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FamilySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const searchActive = query.trim().length > 0;

  useEffect(() => {
    let alive = true;
    fetchRosterReportClient(year)
      .then((res) => { if (alive) { setRows(res.rows); setLoadError(false); } })
      .catch(() => { if (alive) { setRows([]); setLoadError(true); } });
    return () => { alive = false; };
  }, [year]);

  const filters: RosterReportFilters = useMemo(
    () => ({ location, program, level, grade, payment }),
    [location, program, level, grade, payment],
  );

  const all = useMemo(() => rows ?? [], [rows]);
  const filtered = useMemo(() => all.filter((r) => matchesRosterFilters(r, filters)), [all, filters]);
  const summary = useMemo(() => summarizeRoster(all, filters), [all, filters]);
  const levelOptions = useMemo(() => deriveLevelOptions(all), [all]);
  const gradeOptions = useMemo(() => deriveGradeOptions(all), [all]);
  const programOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of all) r.programKeys.forEach((k, i) => { if (!map.has(k)) map.set(k, r.programs[i] ?? k); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  // Reset the incremental window whenever the filter set changes.
  useEffect(() => { setShown(INITIAL_SHOWN); }, [filters]);

  // Search-as-filter (identical to today).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) { setHits([]); setSearched(false); setSearchError(false); return; }
    debounceRef.current = setTimeout(async () => {
      const mySeq = ++seqRef.current;
      setSearching(true); setSearchError(false);
      try {
        const results = await searchFamiliesClient(trimmed);
        if (mySeq !== seqRef.current) return;
        setHits(results); setSearched(true);
      } catch {
        if (mySeq !== seqRef.current) return;
        setSearchError(true); setHits([]); setSearched(true);
      } finally {
        if (mySeq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const visible = filtered.slice(0, shown);
  const loading = rows === null;

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

      {/* Filters + summary - hidden while searching (search ignores filters by design). */}
      {!searchActive && (
        <>
          <div className="col" style={{ gap: 10 }}>
            <FilterRow label="Location">
              <FilterChip active={location === null} onClick={() => setLocation(null)}>All</FilterChip>
              {locationOptions.map((loc) => (
                <FilterChip key={loc} active={location === loc} onClick={() => setLocation(loc)}>{loc}</FilterChip>
              ))}
            </FilterRow>
            <FilterRow label="Program">
              <FilterChip active={program === null} onClick={() => setProgram(null)}>All</FilterChip>
              {programOptions.map(([key, label]) => (
                <FilterChip key={key} active={program === key} onClick={() => setProgram(key)}>{label}</FilterChip>
              ))}
            </FilterRow>
            {levelOptions.length > 0 && (
              <FilterRow label="Level">
                <FilterChip active={level === null} onClick={() => setLevel(null)}>All</FilterChip>
                {levelOptions.map((lv) => (
                  <FilterChip key={lv} active={level === lv} onClick={() => setLevel(lv)}>{lv}</FilterChip>
                ))}
              </FilterRow>
            )}
            {gradeOptions.length > 0 && (
              <FilterRow label="Grade">
                <FilterChip active={grade === null} onClick={() => setGrade(null)}>All</FilterChip>
                {gradeOptions.map((g) => (
                  <FilterChip key={g} active={grade === g} onClick={() => setGrade(g)}>{g}</FilterChip>
                ))}
              </FilterRow>
            )}
            <FilterRow label="Payment">
              <FilterChip active={payment === null} onClick={() => setPayment(null)}>All</FilterChip>
              {ROSTER_PAYMENTS.map((p) => (
                <FilterChip key={p} active={payment === p} onClick={() => setPayment(p)}>
                  {p[0]!.toUpperCase() + p.slice(1)}
                </FilterChip>
              ))}
            </FilterRow>
          </div>

          {!loading && !loadError && <SummaryStrip summary={summary} />}
        </>
      )}

      {/* Count + export */}
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontFeatureSettings: '"tnum"' }}>
          {searchActive
            ? (searched && !searching ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : ' ')
            : (loading ? ' ' : `${filtered.length.toLocaleString()} famil${filtered.length === 1 ? 'y' : 'ies'}`)}
        </span>
        <RosterExportButton
          location={location} program={program} level={level} grade={grade} payment={payment}
          {...(year ? { year } : {})}
        />
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
            {loadError && <Notice tone="err">Couldn’t load the roster. Please try again.</Notice>}
            {loading && !loadError && <Notice tone="muted">Loading families…</Notice>}
            {!loading && !loadError && filtered.length === 0 && (
              <Notice tone="muted">No families match these filters.</Notice>
            )}
            {visible.map((row) => <RosterFamilyCard key={row.fid} row={row} />)}
            {shown < filtered.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + INITIAL_SHOWN)}
                className="focus-ring"
                style={{
                  minHeight: 44, marginTop: 4,
                  fontSize: 13, fontWeight: 600,
                  background: 'var(--surface)', color: 'var(--accentDeep)',
                  border: '1px solid var(--line)', borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                }}
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function RosterBrowser({ year, locationOptions }: { year?: string; locationOptions: string[] }) {
  return (
    <>
      {/* Mobile - own CspRoot + 90px bottom padding for the fixed WelcomeMobileNav. */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div style={{ marginBottom: 20 }}>
              <SetuLogo size={18} />
            </div>
            <header style={{ marginBottom: 18 }}>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em' }}>Roster</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                Filter every family by location, program, level, grade, or payment - or search by name, email, phone, or FID.
              </p>
            </header>
            <RosterContent locationOptions={locationOptions} {...(year ? { year } : {})} />
          </div>
        </CspRoot>
      </div>

      {/* Desktop - layout.tsx owns the sidebar + main wrapper. */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Roster</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Filter every family by location, program, level, grade, or payment - or search by name, email, phone, or FID.
          </p>
        </header>
        <div style={{ maxWidth: 720 }}>
          <RosterContent locationOptions={locationOptions} {...(year ? { year } : {})} />
        </div>
      </div>
    </>
  );
}
