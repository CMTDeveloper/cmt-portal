'use client';

import { useState, useTransition } from 'react';
import { SetuIcon } from '@cmt/ui';

interface Props {
  /** Current filters so the export matches what's on screen. */
  location?: string | null;
  program?: string | null;
  level?: string | null;
  grade?: string | null;
  payment?: string | null;
  /** School-year scope ("2025-26"); omitted for the live year. */
  year?: string;
}

/**
 * Streams the roster CSV for the currently-applied filters. Reuses the
 * fetch -> blob -> `a.download` pattern from check-in's report-export-button, but
 * targets `/api/welcome/roster/report?...&format=csv` (one row per person). The
 * server re-runs the bulk builder and applies the same filter predicate as the
 * on-screen list.
 */
export function RosterExportButton({ location, program, level, grade, payment, year }: Props) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onClick() {
    setFailed(false);
    startTransition(async () => {
      try {
        const qs = new URLSearchParams({ format: 'csv' });
        if (location) qs.set('location', location);
        if (program) qs.set('program', program);
        if (level) qs.set('level', level);
        if (grade) qs.set('grade', grade);
        if (payment) qs.set('payment', payment);
        if (year) qs.set('year', year);
        const res = await fetch(`/api/welcome/roster/report?${qs.toString()}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`export-failed-${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'roster.csv';
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Surface the failure instead of silently doing nothing - a large
        // export can time out or 5xx, and a dead button is confusing.
        setFailed(true);
      }
    });
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="focus-ring"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          minHeight: 44, padding: '0 16px',
          fontSize: 13, fontWeight: 600, lineHeight: 1,
          color: pending ? 'var(--muted)' : 'var(--accentDeep)',
          background: 'var(--accentSoft)',
          border: '1px solid transparent',
          borderRadius: 'var(--radius)',
          cursor: pending ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <SetuIcon.dl />
        {pending ? 'Exporting…' : 'Export CSV'}
      </button>
      {failed && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--err)', whiteSpace: 'nowrap' }}>
          Export failed - try again
        </span>
      )}
    </span>
  );
}
