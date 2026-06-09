'use client';

import { useState, useTransition } from 'react';
import { SetuIcon } from '@cmt/ui';
import type { ReportKindKey, FetchReportParams } from './reports-client';

interface Props {
  kind: ReportKindKey;
  /** Filename stem for the downloaded CSV (e.g. `enrollment-people`). */
  filename: string;
  /** Visible button label (e.g. "Export people CSV"). */
  label?: string;
  /** Mirrors the on-screen scope so the export matches what's shown. */
  params?: FetchReportParams;
}

/**
 * Streams a report CSV. Reuses the fetch → blob → `a.download` pattern from the
 * Phase 3 roster export button, surfacing "Export failed — try again" on a
 * non-OK response instead of silently doing nothing (a dead button is
 * confusing on a large/slow export).
 */
export function ReportExportButton({ kind, filename, label = 'Export CSV', params = {} }: Props) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onClick() {
    setFailed(false);
    startTransition(async () => {
      try {
        const qs = new URLSearchParams({ format: 'csv' });
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        if (params.program) qs.set('program', params.program);
        const res = await fetch(`/api/welcome/reports/${kind}?${qs.toString()}`, {
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`export-failed-${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
        {pending ? 'Exporting…' : label}
      </button>
      {failed && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--err)', whiteSpace: 'nowrap' }}>
          Export failed — try again
        </span>
      )}
    </span>
  );
}
