'use client';

import { useState } from 'react';
import {
  LevelsTable,
  type LevelRow,
  type LevelTeacher,
  type PeriodOption,
  type TeacherAssignmentChange,
} from './levels-table';
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
  // The location filter is ALWAYS exactly one centre - there is no "All" (a
  // focused single-centre list, per the owner requirement). Default to the
  // first configured centre.
  const [selectedLocation, setSelectedLocation] = useState<string>(locationOptions[0] ?? 'Brampton');
  const [search, setSearch] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);

  // Keep the parent's `levels[].teacherRefs` in sync when a pill is added or
  // removed inline, so the modal/edit flow and the stat cards see the current
  // teacher set.
  function handleAssignmentSaved(change: TeacherAssignmentChange) {
    setLevels((prev) =>
      prev.map((level) => {
        if (level.levelId !== change.levelId) return level;
        if (change.op === 'add') {
          if (level.teacherRefs.includes(change.mid)) return level;
          return { ...level, teacherRefs: [...level.teacherRefs, change.mid] };
        }
        return { ...level, teacherRefs: level.teacherRefs.filter((ref) => ref !== change.mid) };
      }),
    );
  }

  // Derived filtered list for the stat cards (mirrors the list the table renders:
  // always exactly one location, never "all"). The table applies the same
  // location/search/showDisabled filters from these props.
  const query = search.trim().toLowerCase();
  const filtered = levels
    .filter((l) => (l.location ?? 'Brampton') === selectedLocation)
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

      {/* Master-detail: left = the levels list; right = the teacher detail panel
          (Task 12 fills it; for now it is a placeholder with an empty-state prompt). */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="card" style={{ padding: 22 }}>
          <LevelsTable
            initialLevels={levels}
            periods={periods}
            programs={programs}
            teachersByLevel={teachersByLevel ?? {}}
            onLevelsChange={setLevels}
            onAssignmentSaved={handleAssignmentSaved}
            readOnly={readOnly}
            selectedLocation={selectedLocation}
            search={search}
            showDisabled={showDisabled}
            selectedLevelId={selectedLevelId}
            onSelectLevel={setSelectedLevelId}
          />
        </div>
        <LevelDetailPanel selectedLevel={selectedLevel} />
      </div>
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

// ─── Detail panel placeholder ────────────────────────────────────────────────
// Task 12 replaces this with the full teacher-management panel. For now it shows
// an empty-state prompt when nothing is selected, and a minimal summary once a
// level is picked so selection is visibly wired.

function LevelDetailPanel({ selectedLevel }: { selectedLevel: LevelRow | null }) {
  if (!selectedLevel) {
    return (
      <div
        className="card"
        style={{ padding: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 180 }}
      >
        <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 240, lineHeight: 1.5 }}>
          Select a level to manage its teachers.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Selected level</p>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>{selectedLevel.levelName}</h2>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 4 }}>
        {selectedLevel.location ?? 'Brampton'} · {selectedLevel.periodLabel}
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
        Teacher management for this level is moving here.
      </p>
    </div>
  );
}
