'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from '@cmt/ui';
import { GRADE_BAND_OPTIONS } from '@cmt/shared-domain';
import type {
  LevelDoc,
  CreateLevelInput,
  UpdateLevelInput,
  LevelKind,
  Location,
} from '@cmt/shared-domain';
import type { ProgramRow } from '@/features/admin/programs/programs-table';
import { searchTeachersClient, type TeacherHit } from './assign-teacher-client';

// Serialised shape from GET /api/admin/levels (Timestamps → ISO strings).
export type LevelRow = Omit<LevelDoc, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export interface PeriodOption {
  pid: string;
  periodLabel: string;
  location: Location;
}

/** A resolved teacher shown as a pill: mid paired with its display name. */
export interface LevelTeacher {
  mid: string;
  name: string;
}

interface LevelsTableProps {
  initialLevels: LevelRow[];
  periods: PeriodOption[];
  /** Optional list of programs to show a program selector (E3). When absent the selector is hidden. */
  programs?: ProgramRow[];
  /** levelId → resolved {mid,name} teachers, paired by mid (never zipped by index).
   * Owned by LevelsManagement; the row renders these read-only (add/remove/lead
   * happen only in the detail panel). */
  teachersByLevel?: Record<string, LevelTeacher[]>;
  onLevelsChange?: (levels: LevelRow[]) => void;
  /** When true (viewing a past school year), mutate controls are disabled. */
  readOnly?: boolean;
  // ── Filter values, owned by LevelsManagement (the parent filter bar). ──────
  /** Restrict the list to one centre. When omitted, no location filter applies. */
  selectedLocation?: string;
  /** Substring match over levelName + curriculum. */
  search?: string;
  /** When true, disabled levels are included in the list. */
  showDisabled?: boolean;
  // ── Master-list selection, driven by LevelsManagement. ────────────────────
  /** The currently selected level's id (highlighted row); null when none. */
  selectedLevelId?: string | null;
  /** Row click handler; selects the level for the detail panel. */
  onSelectLevel?: (levelId: string) => void;
}

const LEVEL_KIND_LABELS: Record<LevelKind, string> = {
  shishu: 'Shishu (age 1.5–4)',
  'pre-level': 'Pre-Level (JK/SK)',
  level: 'Level (by grade)',
  parents: 'Parents (adults)',
};

function bandNeedsGrades(kind: LevelKind): boolean {
  return kind === 'level' || kind === 'pre-level';
}

// ─── Modal ───────────────────────────────────────────────────────────────────

interface ModalProps {
  editing: LevelRow | null;
  periods: PeriodOption[];
  programKey?: string;
  onClose: () => void;
  onSaved: (level: LevelRow) => void;
}

function LevelModal({ editing, periods, programKey: propProgramKey, onClose, onSaved }: ModalProps) {
  const isEdit = editing !== null;
  const [pending, startTransition] = useTransition();

  const [pid, setPid] = useState(editing?.pid ?? periods[0]?.pid ?? '');
  const [levelName, setLevelName] = useState(editing?.levelName ?? '');
  const [levelKind, setLevelKind] = useState<LevelKind>(editing?.levelKind ?? 'level');
  const [gradeBand, setGradeBand] = useState<string[]>(editing?.gradeBand ?? []);
  const [curriculum, setCurriculum] = useState(editing?.curriculum ?? '');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedPeriod = periods.find((p) => p.pid === pid);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!isEdit && !pid) e.pid = 'Select a period';
    if (!levelName.trim()) e.levelName = 'Required';
    if (!curriculum.trim()) e.curriculum = 'Required';
    if (!isEdit && teacherEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail.trim())) {
      e.teacherEmail = 'Enter a valid email';
    }
    if (bandNeedsGrades(levelKind) && gradeBand.length === 0) {
      e.gradeBand = 'Levels and pre-levels need at least one grade';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    const band = bandNeedsGrades(levelKind) ? gradeBand : [];

    startTransition(async () => {
      try {
        let res: Response;
        if (isEdit) {
          const body: UpdateLevelInput = {};
          if (levelName !== editing.levelName) body.levelName = levelName;
          if (levelKind !== editing.levelKind) body.levelKind = levelKind;
          if (JSON.stringify(band) !== JSON.stringify(editing.gradeBand)) body.gradeBand = band;
          if (curriculum !== editing.curriculum) body.curriculum = curriculum;
          if (enabled !== editing.enabled) body.enabled = enabled;
          res = await fetch(`/api/admin/levels/${editing.levelId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else {
          const period = periods.find((p) => p.pid === pid)!;
          const body: CreateLevelInput = {
            programKey: propProgramKey ?? 'bala-vihar',
            location: period.location,
            pid,
            levelName,
            levelKind,
            gradeBand: band,
            curriculum,
            enabled,
          };
          if (teacherEmail.trim()) body.teacherEmail = teacherEmail.trim();
          res = await fetch('/api/admin/levels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error(saveErrorCopy(json.error) ?? json.error ?? 'Save failed');
          return;
        }
        const json = (await res.json()) as {
          levelId?: string;
          order?: number;
          teacherRef?: string | null;
        };
        toast.success(
          isEdit
            ? 'Level updated.'
            : json.teacherRef
              ? 'Level created and teacher assigned.'
              : 'Level created.',
        );

        const now = new Date().toISOString();
        const period = periods.find((p) => p.pid === pid);
        onSaved({
          levelId: json.levelId ?? editing?.levelId ?? '',
          programKey: propProgramKey ?? editing?.programKey ?? 'bala-vihar',
          location: period?.location ?? editing?.location ?? 'Brampton',
          levelName,
          levelKind,
          order: json.order ?? editing?.order ?? 0,
          gradeBand: band,
          curriculum,
          pid,
          periodLabel: period?.periodLabel ?? editing?.periodLabel ?? '',
          teacherRefs: isEdit ? editing.teacherRefs : json.teacherRef ? [json.teacherRef] : [],
          enabled,
          createdAt: editing?.createdAt ?? now,
          createdBy: editing?.createdBy ?? '',
          updatedAt: now,
          updatedBy: editing?.updatedBy ?? '',
        });
        onClose();
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 28, width: '100%', maxWidth: 540, boxShadow: '0 8px 32px rgba(0,0,0,.18)', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{isEdit ? 'Edit level' : 'New level'}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 20, cursor: 'pointer', color: 'var(--muted)', padding: 4 }} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={labelStyle}>
              Period
              <select value={pid} onChange={(e) => setPid(e.target.value)} disabled={isEdit} style={fieldStyle}>
                {periods.length === 0 && <option value="">No periods — create one first</option>}
                {periods.map((p) => (
                  <option key={p.pid} value={p.pid}>{p.location} · {p.periodLabel}</option>
                ))}
              </select>
              {errors.pid && <FieldError msg={errors.pid} />}
            </label>

            {isEdit && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedPeriod?.location ?? editing.location} · {editing.periodLabel}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={labelStyle}>
                Level name
                <input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="Level 2" style={fieldStyle} />
                {errors.levelName && <FieldError msg={errors.levelName} />}
              </label>
            </div>

            <label style={labelStyle}>
              Kind
              <select value={levelKind} onChange={(e) => setLevelKind(e.target.value as LevelKind)} style={fieldStyle}>
                {(Object.keys(LEVEL_KIND_LABELS) as LevelKind[]).map((k) => (
                  <option key={k} value={k}>{LEVEL_KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>

            <div style={labelStyle}>
              Grades {bandNeedsGrades(levelKind) ? '' : '(not used for this kind)'}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, opacity: bandNeedsGrades(levelKind) ? 1 : 0.5 }}>
                {GRADE_BAND_OPTIONS.map((g) => {
                  const checked = gradeBand.includes(g.value);
                  return (
                    <label key={g.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400, textTransform: 'none', letterSpacing: 0, cursor: bandNeedsGrades(levelKind) ? 'pointer' : 'default', padding: '4px 10px', borderRadius: 999, border: `1px solid ${checked ? 'var(--accent)' : 'var(--line2)'}`, background: checked ? 'var(--accentSoft)' : 'var(--bg)', color: checked ? 'var(--accentDeep)' : 'var(--body-text)' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!bandNeedsGrades(levelKind)}
                        onChange={() =>
                          setGradeBand((prev) => (prev.includes(g.value) ? prev.filter((v) => v !== g.value) : [...prev, g.value]))
                        }
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      {g.label}
                    </label>
                  );
                })}
              </div>
              {errors.gradeBand && <FieldError msg={errors.gradeBand} />}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={labelStyle}>
                Curriculum
                <input value={curriculum} onChange={(e) => setCurriculum(e.target.value)} placeholder="Hanuman" style={fieldStyle} />
                {errors.curriculum && <FieldError msg={errors.curriculum} />}
              </label>
            </div>

            {!isEdit && (
              <label style={labelStyle}>
                Teacher email (optional)
                <input
                  type="email"
                  value={teacherEmail}
                  onChange={(e) => setTeacherEmail(e.target.value)}
                  placeholder="teacher@example.com"
                  style={fieldStyle}
                />
                {errors.teacherEmail && <FieldError msg={errors.teacherEmail} />}
              </label>
            )}

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              Enabled
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 500, background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--body-text)', fontFamily: 'var(--body)' }}>
              Cancel
            </button>
            <button type="submit" disabled={pending || (!isEdit && periods.length === 0)} className="btn btn--p" style={{ padding: '9px 22px', fontSize: 13, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create level'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <span style={{ fontSize: 11, color: 'var(--err)', marginTop: 4, display: 'block' }}>{msg}</span>;
}

function saveErrorCopy(code: unknown): string | null {
  if (code === 'teacher-not-found') return 'No registered member was found for that teacher email.';
  if (code === 'teacher-not-active') return 'That member cannot sign in yet. Approve their family access first.';
  if (code === 'invalid-teacher-email') return 'Enter a valid teacher email.';
  if (code === 'level-conflict') return 'A level with that name already exists for this period.';
  return null;
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' };
const fieldStyle: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--body)', boxSizing: 'border-box' };

// ─── Main table ────────────────────────────────────────────────────────────────

export function LevelsTable({
  initialLevels,
  periods,
  programs,
  teachersByLevel,
  onLevelsChange,
  readOnly = false,
  selectedLocation,
  search = '',
  showDisabled = false,
  selectedLevelId = null,
  onSelectLevel,
}: LevelsTableProps) {
  const [levels, setLevels] = useState<LevelRow[]>(initialLevels);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LevelRow | null>(null);
  // Program filter: default to 'bala-vihar' if programs prop provided
  const [selectedProgramKey, setSelectedProgramKey] = useState('bala-vihar');
  // Read-only teacher pills, owned by LevelsManagement (single source of truth).
  // The row only displays them; add/remove/lead happen in the detail panel.
  const teachersByLevelMap = teachersByLevel ?? {};

  // Filter programs that use levels (for the selector)
  const levelPrograms = programs?.filter((p) => p.capabilities.usesLevels) ?? [];

  // Filtering is driven by the parent's filter bar (location + search +
  // showDisabled) plus this toolbar's own program selector.
  const query = search.trim().toLowerCase();
  const displayed = levels
    .filter((l) => !selectedLocation || (l.location ?? 'Brampton') === selectedLocation)
    .filter((l) => showDisabled || l.enabled)
    .filter((l) => !programs || l.programKey === selectedProgramKey)
    .filter((l) => !query || `${l.levelName} ${l.curriculum}`.toLowerCase().includes(query));

  function updateLevels(updater: (prev: LevelRow[]) => LevelRow[]) {
    setLevels((prev) => {
      const next = updater(prev);
      onLevelsChange?.(next);
      return next;
    });
  }

  function handleSaved(updated: LevelRow) {
    updateLevels((prev) => {
      const idx = prev.findIndex((l) => l.levelId === updated.levelId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated].sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '') || a.order - b.order);
    });
  }

  async function handleToggle(row: LevelRow) {
    try {
      const res = await fetch(`/api/admin/levels/${row.levelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      if (!res.ok) { toast.error('Toggle failed'); return; }
      updateLevels((prev) => prev.map((l) => (l.levelId === row.levelId ? { ...l, enabled: !l.enabled } : l)));
      toast.success(row.enabled ? 'Level disabled.' : 'Level enabled.');
    } catch {
      toast.error('Network error');
    }
  }

  // Plain render helper (NOT a nested component) - inlined into both the desktop
  // table cell and the mobile card so the read-only teacher summary renders the
  // same in each. Calling it as `teacherCell(l)` keeps element identity stable.
  // Teacher management (add/remove/lead) lives ONLY in the detail panel; the row
  // is a read-only summary so there is a single source of truth.
  const teacherCell = (l: LevelRow) => {
    const list = teachersByLevelMap[l.levelId] ?? [];
    if (list.length === 0) {
      return <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>;
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {list.map((t) => {
          const isLead = l.leadTeacherRef === t.mid;
          return (
            <span
              key={t.mid}
              className="pill"
              style={{ fontSize: 11, fontWeight: 600, background: 'var(--surface2)', color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999 }}
            >
              {t.name}
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: isLead ? 'var(--accentDeep)' : 'var(--muted)' }}>
                {isLead ? 'Lead' : 'Asst'}
              </span>
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {levelPrograms.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--body-text)' }}>
            <span>Program</span>
            <select
              value={selectedProgramKey}
              onChange={(e) => setSelectedProgramKey(e.target.value)}
              style={{ marginLeft: 2, padding: '5px 8px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, fontFamily: 'var(--body)' }}
              aria-label="Program"
            >
              {levelPrograms.map((p) => (
                <option key={p.programKey} value={p.programKey}>{p.label}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn--p" onClick={() => { setEditing(null); setModalOpen(true); }} disabled={readOnly} style={{ fontSize: 13, padding: '8px 18px', opacity: readOnly ? 0.5 : 1 }}>+ New level</button>
      </div>

      {displayed.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          {levels.length === 0 ? 'No levels yet. Create one or run the seed script.' : 'No enabled levels. Toggle “Show disabled” to see all.'}
        </div>
      ) : (
        <>
          {/* Mobile: stacked card rows — table overflows a phone width. */}
          <div className="block md:hidden">
            {displayed.map((l, i) => (
              <div
                key={l.levelId}
                onClick={() => onSelectLevel?.(l.levelId)}
                style={{
                  padding: '16px 0',
                  borderTop: i > 0 ? '1px solid var(--line)' : undefined,
                  cursor: onSelectLevel ? 'pointer' : 'default',
                  background: l.levelId === selectedLevelId ? 'var(--accentSoft)' : undefined,
                  boxShadow: l.levelId === selectedLevelId ? 'inset 3px 0 0 var(--accent)' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{l.levelName}</span>
                      <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--line2)' }}>{l.location}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{l.periodLabel}</div>
                  </div>
                  <span style={{ flex: '0 0 auto', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: l.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: l.enabled ? 'var(--accentDeep)' : 'var(--muted)' }}>
                    {l.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13 }}>
                  <span style={cardKeyStyle}>Kind</span>
                  <span style={{ color: 'var(--body-text)' }}>{l.levelKind}</span>
                  <span style={cardKeyStyle}>Grades</span>
                  <span style={{ color: 'var(--body-text)' }}>{l.gradeBand.length ? l.gradeBand.join(', ') : '—'}</span>
                  <span style={cardKeyStyle}>Curriculum</span>
                  <span style={{ color: 'var(--body-text)' }}>{l.curriculum}</span>
                  <span style={cardKeyStyle}>Teachers</span>
                  <div style={{ color: 'var(--body-text)' }}>{teacherCell(l)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => { setEditing(l); setModalOpen(true); }} disabled={readOnly} style={{ ...actionBtnStyle, flex: 1, textAlign: 'center', padding: '9px 12px', opacity: readOnly ? 0.5 : 1 }}>Edit</button>
                  <button onClick={() => handleToggle(l)} disabled={readOnly} style={{ ...actionBtnStyle, flex: 1, textAlign: 'center', padding: '9px 12px', opacity: readOnly ? 0.5 : 1 }}>{l.enabled ? 'Disable' : 'Enable'}</button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: full table. */}
          <div className="hidden md:block" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  {['Location', 'Period', 'Level', 'Kind', 'Grades', 'Curriculum', 'Teachers', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((l, i) => (
                  <tr
                    key={l.levelId}
                    onClick={() => onSelectLevel?.(l.levelId)}
                    aria-selected={l.levelId === selectedLevelId}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: l.levelId === selectedLevelId ? 'var(--accentSoft)' : i % 2 === 0 ? 'transparent' : 'var(--bg)',
                      cursor: onSelectLevel ? 'pointer' : 'default',
                      boxShadow: l.levelId === selectedLevelId ? 'inset 3px 0 0 var(--accent)' : undefined,
                    }}
                  >
                    <td style={tdStyle}>{l.location}</td>
                    <td style={tdStyle}>{l.periodLabel}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{l.levelName}</td>
                    <td style={{ ...tdStyle, color: 'var(--body-text)' }}>{l.levelKind}</td>
                    <td style={{ ...tdStyle, color: 'var(--body-text)' }}>{l.gradeBand.length ? l.gradeBand.join(', ') : '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--body-text)' }}>{l.curriculum}</td>
                    <td style={tdStyle}>{teacherCell(l)}</td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: l.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: l.enabled ? 'var(--accentDeep)' : 'var(--muted)' }}>
                        {l.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button onClick={() => { setEditing(l); setModalOpen(true); }} disabled={readOnly} style={{ ...actionBtnStyle, opacity: readOnly ? 0.5 : 1 }}>Edit</button>
                      <button onClick={() => handleToggle(l)} disabled={readOnly} style={{ ...actionBtnStyle, marginLeft: 6, opacity: readOnly ? 0.5 : 1 }}>{l.enabled ? 'Disable' : 'Enable'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modalOpen && <LevelModal editing={editing} periods={periods} programKey={selectedProgramKey} onClose={() => { setModalOpen(false); setEditing(null); }} onSaved={handleSaved} />}
    </>
  );
}

const tdStyle: React.CSSProperties = { padding: '12px 12px', verticalAlign: 'middle' };
const actionBtnStyle: React.CSSProperties = { padding: '5px 12px', borderRadius: 'var(--radiusSm)', fontSize: 12, fontWeight: 500, background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--body-text)', fontFamily: 'var(--body)' };
const cardKeyStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap', paddingTop: 1 };

// ─── Assign-teacher popover ──────────────────────────────────────────────────
// Module-scope so its identity is stable across LevelsTable re-renders (a nested
// component would remount every render and drop the search input's focus).

interface AssignTeacherPopoverProps {
  /** mids already assigned to this level — shown disabled so you can't add twice. */
  existingMids: string[];
  onPick: (hit: TeacherHit) => void;
  onClose: () => void;
}

export function AssignTeacherPopover({ existingMids, onPick, onClose }: AssignTeacherPopoverProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TeacherHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchTeachersClient(trimmed)
        .then((hits) => {
          if (cancelled) return;
          setResults(hits);
          setSearched(true);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setSearched(true);
          toast.error('Teacher search failed — please try again.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 20, width: 280, maxWidth: '80vw', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 'var(--radiusSm)', boxShadow: '0 6px 24px rgba(0,0,0,.15)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search teacher"
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)', fontSize: 13, fontFamily: 'var(--body)', color: 'var(--ink)' }}
        />
        <button type="button" aria-label="Close teacher search" onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
      </div>
      {loading && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 2px' }}>Searching…</div>}
      {!loading && searched && results.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 2px' }}>No matches.</div>
      )}
      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 220, overflowY: 'auto' }}>
          {results.map((hit) => {
            const already = existingMids.includes(hit.mid);
            return (
              <button
                key={hit.mid}
                type="button"
                disabled={already}
                onClick={() => onPick(hit)}
                style={{ textAlign: 'left', padding: '7px 8px', border: 0, borderRadius: 'var(--radiusSm)', background: 'transparent', cursor: already ? 'default' : 'pointer', fontFamily: 'var(--body)', opacity: already ? 0.5 : 1 }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{hit.name}</span>
                {hit.email && <span style={{ fontSize: 12, color: 'var(--muted)' }}> — {hit.email}</span>}
                {already && <span style={{ fontSize: 11, color: 'var(--muted)' }}> · assigned</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
