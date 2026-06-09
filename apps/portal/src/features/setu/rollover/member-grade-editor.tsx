'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';
import { GRADE_LADDER, normalizeGrade } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { setGradeClient } from './set-grade-client';

interface MemberGradeEditorProps {
  fid: string;
  mid: string;
  childName: string;
  /** The member's stored schoolGrade ("Grade 4" / "4" / "JK" / null). */
  currentGrade: string | null;
}

/** Display label for a ladder rung: numeric rungs read "Grade N"; JK/SK as-is. */
function gradeLabel(g: (typeof GRADE_LADDER)[number]): string {
  return /^\d/.test(g) ? `Grade ${g}` : g;
}

/** The member's stored grade as a ladder rung, or '' (placeholder) when it's
 *  off-ladder / unset. Normalizes both sides so "Grade 4"/"4" map to "4" and
 *  "JK"/"jk" map to "JK" — matching what decidePromotion() expects on the next
 *  rollover preview. */
function rungForCurrentGrade(currentGrade: string | null): string {
  if (!currentGrade || currentGrade.trim() === '') return '';
  const norm = normalizeGrade(currentGrade);
  const match = GRADE_LADDER.find((g) => normalizeGrade(g) === norm);
  return match ?? '';
}

/**
 * Admin-only inline editor for a single child's `schoolGrade` on the welcome
 * member detail page. Mirrors the rollover preview's inline grade pill (mist
 * surface select + accent Save, both ≥44px) so the two admin surfaces share one
 * visual language. Renders a quiet warn-toned panel — the same warn surface the
 * rollover "Need attention" rows use — so it reads as "the actionable admin fix"
 * sitting distinct from the read-only profile above it.
 *
 * On save → setGradeClient → success toast → router.refresh() so the server page
 * re-reads the member (the grade + Bala Vihar journey both update). Errors toast
 * and leave the control re-armed.
 *
 * Wrapped in CspRoot so brand tokens resolve wherever the page mounts it (the
 * desktop branch isn't always inside a .csp ancestor; tokens are .csp-scoped).
 */
export function MemberGradeEditor({ fid, mid, childName, currentGrade }: MemberGradeEditorProps) {
  const router = useRouter();
  const [grade, setGrade] = useState(() => rungForCurrentGrade(currentGrade));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!grade || saving) return;
    setSaving(true);
    try {
      // grade is one of GRADE_LADDER (the only options rendered), which is the
      // SetMemberGradeBody.schoolGrade enum the endpoint validates against.
      await setGradeClient({ fid, mid, schoolGrade: grade as (typeof GRADE_LADDER)[number] });
      toast.success(`Grade set for ${childName}`);
      router.refresh();
    } catch {
      toast.error('Could not set grade. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CspRoot
      className="member-grade-editor"
      style={{
        marginTop: 18,
        padding: '14px 16px',
        border: '1px solid var(--setu-warn-soft)',
        borderRadius: 'var(--radiusSm)',
        background: 'var(--setu-warn-soft)',
      }}
    >
      <p
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--warn, #a06410)',
          margin: '0 0 4px',
        }}
      >
        Admin · Set grade
      </p>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--body-text)', margin: '0 0 12px' }}>
        Current grade:{' '}
        <strong style={{ color: 'var(--ink)' }}>
          {currentGrade && currentGrade.trim() !== '' ? currentGrade : 'not set'}
        </strong>
        . Setting a school grade lets {childName} promote correctly on the next school-year rollover.
      </p>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          aria-label={`Grade for ${childName}`}
          value={grade}
          disabled={saving}
          onChange={(e) => setGrade(e.target.value)}
          className="member-grade-select"
          style={{
            minHeight: 44,
            padding: '0 30px 0 13px',
            fontSize: 13.5,
            fontWeight: 600,
            fontFamily: 'var(--body)',
            color: grade ? 'var(--ink)' : 'var(--muted)',
            background: 'var(--surface)',
            border: '1px solid var(--line2)',
            borderRadius: 999,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
            // Native chevron via a token-coloured SVG so the pill stays in the
            // Cool-Mist set rather than reading as a default OS control.
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a06410' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 13px center',
          }}
        >
          <option value="" disabled>
            Set grade…
          </option>
          {GRADE_LADDER.map((g) => (
            <option key={g} value={g}>
              {gradeLabel(g)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={saving || !grade}
          aria-label={`Save grade for ${childName}`}
          className="member-grade-save"
          style={{
            minHeight: 44,
            minWidth: 44,
            padding: '0 18px',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'var(--body)',
            color: '#fff',
            background: 'var(--accent)',
            border: '1px solid var(--accentDeep)',
            borderRadius: 999,
            cursor: saving || !grade ? 'default' : 'pointer',
            opacity: saving || !grade ? 0.55 : 1,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </span>
    </CspRoot>
  );
}
