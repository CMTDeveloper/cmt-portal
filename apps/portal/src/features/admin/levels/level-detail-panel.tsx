'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { AssignTeacherPopover, type LevelRow, type LevelTeacher } from './levels-table';
import {
  addLevelTeacherClient,
  removeLevelTeacherClient,
  setLevelLeadTeacherClient,
  type TeacherHit,
} from './assign-teacher-client';

export interface LevelDetailPanelProps {
  /** The selected level, or null for the empty state. */
  level: LevelRow | null;
  /** Resolved {mid,name} pills for this level - the single source of truth
   * owned by LevelsManagement. */
  teachers: LevelTeacher[];
  /** When true (viewing a past school year), mutate controls are hidden. */
  readOnly?: boolean;
  onTeacherAdded: (mid: string, name: string) => void;
  onTeacherRemoved: (mid: string) => void;
  onLeadChanged: (mid: string | null) => void;
}

/**
 * Right-hand detail panel for the selected level. It is the ONLY place teachers
 * are added, removed, or promoted to Lead - the list row shows a read-only
 * summary. All mutations go through the shared -client wrappers, then bubble up
 * via the on* callbacks so LevelsManagement keeps levels[].teacherRefs /
 * leadTeacherRef in sync.
 */
export function LevelDetailPanel({
  level,
  teachers,
  readOnly = false,
  onTeacherAdded,
  onTeacherRemoved,
  onLeadChanged,
}: LevelDetailPanelProps) {
  const [assigning, setAssigning] = useState(false);

  if (!level) {
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

  // Capture per-render primitives so the async handlers never lean on control-flow
  // narrowing of the `level` prop inside their closures.
  const levelId = level.levelId;
  const leadRef = level.leadTeacherRef ?? null;

  async function handleAdd(hit: TeacherHit) {
    if (teachers.some((t) => t.mid === hit.mid)) {
      toast.error(`${hit.name} is already assigned to this level.`);
      return;
    }
    try {
      await addLevelTeacherClient(levelId, hit.mid);
      onTeacherAdded(hit.mid, hit.name);
      setAssigning(false);
      toast.success(`Assigned ${hit.name}. Takes effect on their next sign-in.`);
    } catch {
      toast.error('Could not assign teacher - please try again.');
    }
  }

  async function handleRemove(mid: string) {
    try {
      await removeLevelTeacherClient(levelId, mid);
      onTeacherRemoved(mid);
      // Mirror the server's clear-on-lead-removal (Task 10): dropping the current
      // lead also clears leadTeacherRef.
      if (leadRef === mid) onLeadChanged(null);
      toast.success('Teacher removed. Takes effect on their next sign-in.');
    } catch {
      toast.error('Could not remove teacher - please try again.');
    }
  }

  async function handleMakeLead(mid: string) {
    try {
      await setLevelLeadTeacherClient(levelId, mid);
      onLeadChanged(mid);
      toast.success('Lead teacher updated.');
    } catch {
      toast.error('Could not update the lead teacher - please try again.');
    }
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Selected level</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{level.levelName}</h2>
        <span
          style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: level.enabled ? 'var(--accentSoft)' : 'var(--surface2)', color: level.enabled ? 'var(--accentDeep)' : 'var(--muted)' }}
        >
          {level.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 4 }}>
        {level.location ?? 'Brampton'} · {level.periodLabel}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 13, marginTop: 12 }}>
        <span style={metaKeyStyle}>Grades</span>
        <span style={{ color: 'var(--body-text)' }}>{level.gradeBand.length ? level.gradeBand.join(', ') : '—'}</span>
        <span style={metaKeyStyle}>Curriculum</span>
        <span style={{ color: 'var(--body-text)' }}>{level.curriculum}</span>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0 14px' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Teachers</h3>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{teachers.length}</span>
      </div>

      {teachers.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>No teachers assigned yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {teachers.map((t) => {
          const isLead = leadRef === t.mid;
          return (
            <div
              key={t.mid}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radiusSm)', border: '1px solid var(--line2)', background: 'var(--bg)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                <span
                  style={{ display: 'inline-block', marginTop: 3, padding: '2px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', background: isLead ? 'var(--accentSoft)' : 'var(--surface2)', color: isLead ? 'var(--accentDeep)' : 'var(--muted)' }}
                >
                  {isLead ? 'Lead Teacher' : 'Assistant Teacher'}
                </span>
              </div>
              {!readOnly && !isLead && (
                <button
                  type="button"
                  onClick={() => void handleMakeLead(t.mid)}
                  style={{ ...pillBtnStyle }}
                >
                  Make Lead
                </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${t.name}`}
                  onClick={() => void handleRemove(t.mid)}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: 2 }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div style={{ position: 'relative', marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setAssigning((cur) => !cur)}
            style={{ ...pillBtnStyle, padding: '7px 14px' }}
          >
            + Add teacher
          </button>
          {assigning && (
            <AssignTeacherPopover
              existingMids={teachers.map((t) => t.mid)}
              onPick={(hit) => void handleAdd(hit)}
              onClose={() => setAssigning(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

const metaKeyStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap', paddingTop: 1 };
const pillBtnStyle: React.CSSProperties = { padding: '5px 12px', borderRadius: 'var(--radiusSm)', fontSize: 12, fontWeight: 500, background: 'var(--bg)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--body-text)', fontFamily: 'var(--body)' };
