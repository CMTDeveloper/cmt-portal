'use client';

import { useState } from 'react';
import {
  LevelsTable,
  type LevelRow,
  type LevelTeacher,
  type PeriodOption,
} from './levels-table';
import { LevelDetailPanel } from './level-detail-panel';
import type { ProgramRow } from '@/features/admin/programs/programs-table';

interface LevelsManagementProps {
  initialLevels: LevelRow[];
  periods: PeriodOption[];
  programs: ProgramRow[];
  /** Centre options for the always-one-selected location filter (from getLocationOptions()). */
  locationOptions: string[];
  /** levelId → resolved {mid,name} teachers for the inline pills (server-resolved). */
  teachersByLevel?: Record<string, LevelTeacher[]>;
  /** When true (viewing a past school year), mutate controls are disabled. */
  readOnly?: boolean;
}

export function LevelsManagement({
  initialLevels,
  periods,
  programs,
  locationOptions,
  teachersByLevel,
  readOnly = false,
}: LevelsManagementProps) {
  const [levels, setLevels] = useState(initialLevels);
  // Single source of truth for the per-level teacher pills. Both the list (for
  // its read-only row summary) and the detail panel (which mutates them) read
  // from this map, so add/remove/lead stays consistent everywhere.
  const [teachers, setTeachers] = useState<Record<string, LevelTeacher[]>>(teachersByLevel ?? {});
  // The location filter is ALWAYS exactly one centre - there is no "All" (a
  // focused single-centre list, per the owner requirement). Default to the
  // first configured centre.
  const [selectedLocation, setSelectedLocation] = useState<string>(locationOptions[0] ?? 'Brampton');
  // Program filter now lives in the top filter bar (was previously owned by
  // LevelsTable). Default to 'bala-vihar'; passed down to LevelsTable for row
  // filtering + the "+ New level" modal default.
  const [selectedProgramKey, setSelectedProgramKey] = useState('bala-vihar');
  const [search, setSearch] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);

  // Programs that use levels drive the Program select. Mirror the gate the table
  // used: show the select only when there is at least one such program.
  const levelPrograms = programs.filter((p) => p.capabilities.usesLevels);

  // The panel mutates the selected level's teachers; these callbacks update BOTH
  // the `teachers` map (row summary + panel pills) AND `levels[].teacherRefs` /
  // `leadTeacherRef` (stat cards + badges) so every surface stays in sync.
  function handleTeacherAdded(mid: string, name: string) {
    if (!selectedLevelId) return;
    setTeachers((prev) => {
      const list = prev[selectedLevelId] ?? [];
      if (list.some((t) => t.mid === mid)) return prev;
      return { ...prev, [selectedLevelId]: [...list, { mid, name }] };
    });
    setLevels((prev) =>
      prev.map((level) =>
        level.levelId === selectedLevelId && !level.teacherRefs.includes(mid)
          ? { ...level, teacherRefs: [...level.teacherRefs, mid] }
          : level,
      ),
    );
  }

  function handleTeacherRemoved(mid: string) {
    if (!selectedLevelId) return;
    setTeachers((prev) => ({
      ...prev,
      [selectedLevelId]: (prev[selectedLevelId] ?? []).filter((t) => t.mid !== mid),
    }));
    setLevels((prev) =>
      prev.map((level) => {
        if (level.levelId !== selectedLevelId) return level;
        const teacherRefs = level.teacherRefs.filter((ref) => ref !== mid);
        return level.leadTeacherRef === mid
          ? { ...level, teacherRefs, leadTeacherRef: null }
          : { ...level, teacherRefs };
      }),
    );
  }

  function handleLeadChanged(mid: string | null) {
    if (!selectedLevelId) return;
    setLevels((prev) =>
      prev.map((level) =>
        level.levelId === selectedLevelId ? { ...level, leadTeacherRef: mid } : level,
      ),
    );
  }

  // Derived filtered list for the stat cards (mirrors the list the table renders:
  // always exactly one location, never "all"). The table applies the same
  // location/search/showDisabled filters from these props.
  const query = search.trim().toLowerCase();
  const filtered = levels
    .filter((l) => (l.location ?? 'Brampton') === selectedLocation)
    .filter((l) => l.programKey === selectedProgramKey)
    .filter((l) => showDisabled || l.enabled)
    .filter((l) => !query || `${l.levelName} ${l.curriculum}`.toLowerCase().includes(query));

  const stats = {
    total: filtered.length,
    withTeachers: filtered.filter((l) => l.teacherRefs.length > 0).length,
    needingTeachers: filtered.filter((l) => l.teacherRefs.length === 0).length,
  };

  const selectedLevel = selectedLevelId
    ? (levels.find((l) => l.levelId === selectedLevelId) ?? null)
    : null;
  const selectedTeachers = teachers[selectedLevelId ?? ''] ?? [];

  return (
    <section>
      {readOnly && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          Viewing a past year — read-only.
        </p>
      )}

      {/* Sticky filter bar: always-one location toggle + search + show-disabled. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', paddingBottom: 14, marginBottom: 14 }}>
        <div
          className="card"
          style={{ padding: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}
        >
          <div
            role="tablist"
            aria-label="Location"
            style={{ display: 'inline-flex', gap: 4, background: 'var(--surface2)', padding: 3, borderRadius: 999 }}
          >
            {locationOptions.map((loc) => {
              const active = loc === selectedLocation;
              return (
                <button
                  key={loc}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSelectedLocation(loc);
                    setSelectedLevelId(null);
                  }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 999,
                    border: 0,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--body-text)',
                  }}
                >
                  {loc}
                </button>
              );
            })}
          </div>

          {levelPrograms.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--body-text)' }}>
              <span>Program</span>
              <select
                value={selectedProgramKey}
                onChange={(e) => {
                  setSelectedProgramKey(e.target.value);
                  setSelectedLevelId(null);
                }}
                style={{ marginLeft: 2, padding: '5px 8px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, fontFamily: 'var(--body)' }}
                aria-label="Program"
              >
                {levelPrograms.map((p) => (
                  <option key={p.programKey} value={p.programKey}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search levels"
            aria-label="Search levels"
            style={{
              flex: '1 1 180px',
              minWidth: 140,
              padding: '7px 10px',
              borderRadius: 'var(--radiusSm)',
              border: '1px solid var(--line2)',
              background: 'var(--bg)',
              fontSize: 13,
              fontFamily: 'var(--body)',
              color: 'var(--ink)',
            }}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', color: 'var(--body-text)', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={showDisabled}
              onChange={(e) => setShowDisabled(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Show disabled
          </label>
        </div>
      </div>

      {/* Three stat cards over the currently filtered (single-centre) list. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard testId="stat-total" value={stats.total} label="Total levels" tone="neutral" />
        <StatCard testId="stat-with-teachers" value={stats.withTeachers} label="With teachers" tone="ok" />
        <StatCard testId="stat-needing-teachers" value={stats.needingTeachers} label="Needs teachers" tone="warn" />
      </div>

      {/* The mobile bottom-sheet drawer + its backdrop. On mobile the detail
          panel used to strand at the very bottom of the single-column list;
          instead it now opens as a bottom sheet over the list (matching the
          Users & Roles responsive drawer). Desktop is unaffected - the drawer
          block is `md:hidden` and only mounts when a level is selected. */}
      <style>{`
        @keyframes lvl-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lvl-sheet { from { transform: translateY(100%) } to { transform: none } }
        .lvl-backdrop { position: fixed; inset: 0; background: rgba(15,26,34,.4); z-index: 55; animation: lvl-fade .15s ease; }
        .lvl-drawer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 56; max-height: 88dvh; overflow-y: auto;
          background: var(--surface); border-top-left-radius: 18px; border-top-right-radius: 18px; animation: lvl-sheet .22s ease; }
        @media (prefers-reduced-motion: reduce) {
          .lvl-backdrop, .lvl-drawer { animation: none; }
        }
      `}</style>

      {/* Master-detail: left = the levels list (read-only teacher summary);
          right = the teacher detail panel where add/remove/lead happen. On
          desktop the panel column is always visible with its own empty state;
          on mobile it is hidden here and surfaced via the drawer below. */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="card" style={{ padding: 22 }}>
          <LevelsTable
            initialLevels={levels}
            periods={periods}
            programs={programs}
            teachersByLevel={teachers}
            onLevelsChange={setLevels}
            readOnly={readOnly}
            selectedLocation={selectedLocation}
            selectedProgramKey={selectedProgramKey}
            search={search}
            showDisabled={showDisabled}
            selectedLevelId={selectedLevelId}
            onSelectLevel={setSelectedLevelId}
          />
        </div>
        {/* Desktop-only detail column (always visible, keeps its empty state). */}
        <div className="hidden md:block" data-testid="level-detail-desktop">
          <LevelDetailPanel
            level={selectedLevel}
            teachers={selectedTeachers}
            readOnly={readOnly}
            onTeacherAdded={handleTeacherAdded}
            onTeacherRemoved={handleTeacherRemoved}
            onLeadChanged={handleLeadChanged}
          />
        </div>
      </div>

      {/* Mobile drawer: mounted ONLY when a level is selected, so the list is
          full-width otherwise and the empty state is not duplicated. */}
      {selectedLevel && (
        <div className="md:hidden">
          <div className="lvl-backdrop" onClick={() => setSelectedLevelId(null)} />
          <div
            className="lvl-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Level details: ${selectedLevel.levelName}`}
            data-testid="level-detail-mobile"
          >
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '14px 16px 10px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedLevel.levelName}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedLevelId(null)}
                aria-label="Close"
                style={{
                  flex: '0 0 auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radiusSm)',
                  background: 'var(--surface)',
                  color: 'var(--muted)',
                  fontSize: 20,
                  lineHeight: 1,
                  cursor: 'pointer',
                  fontFamily: 'var(--body)',
                }}
              >
                ×
              </button>
            </div>
            {/* Bottom padding clears the fixed mobile nav bar (z-index 50) so the
                Add-teacher control is never hidden behind it. */}
            <div style={{ padding: 14, paddingBottom: 'calc(84px + env(safe-area-inset-bottom))' }}>
              <LevelDetailPanel
                level={selectedLevel}
                teachers={selectedTeachers}
                readOnly={readOnly}
                onTeacherAdded={handleTeacherAdded}
                onTeacherRemoved={handleTeacherRemoved}
                onLeadChanged={handleLeadChanged}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────
// Module scope so its identity is stable across LevelsManagement re-renders.

type StatTone = 'neutral' | 'ok' | 'warn';

const STAT_TONE: Record<StatTone, { rail: string; value: string }> = {
  neutral: { rail: 'var(--line2)', value: 'var(--ink)' },
  ok: { rail: 'var(--accent)', value: 'var(--accentDeep)' },
  warn: { rail: 'var(--warn, #a06410)', value: 'var(--warn, #a06410)' },
};

function StatCard({ testId, value, label, tone }: { testId: string; value: number; label: string; tone: StatTone }) {
  const c = STAT_TONE[tone];
  return (
    <div
      className="card"
      style={{ padding: 0, textAlign: 'center', minWidth: 0, overflow: 'hidden' }}
    >
      <span aria-hidden style={{ display: 'block', height: 3, background: c.rail }} />
      <span style={{ padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <span
          data-testid={testId}
          style={{ fontSize: 'clamp(26px, 8vw, 32px)', fontWeight: 700, color: c.value, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--body-text)', lineHeight: 1.25 }}>{label}</span>
      </span>
    </div>
  );
}
