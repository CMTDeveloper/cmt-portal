'use client';

import { useState } from 'react';
import { SetuIcon } from '@cmt/ui';
import type { MigrationStatusResponse } from '@cmt/shared-domain/setu';
import { fetchMigrationStatusClient } from './roster-client';

/**
 * Compact migration-completeness strip. The reconciliation downloads the whole
 * legacy 715b8 roster (RTDB bills per GB downloaded), so it runs ON DEMAND via
 * the "Check migration status" button - never on page load. Fails QUIET - a
 * failed check renders a muted line with a retry and never throws into the page.
 */
export function MigrationStrip() {
  const [status, setStatus] = useState<MigrationStatusResponse | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [expanded, setExpanded] = useState(false);

  function check() {
    setState('loading');
    fetchMigrationStatusClient()
      .then((s) => { setStatus(s); setState('ok'); })
      .catch(() => setState('error'));
  }

  if (state === 'idle') {
    return (
      <div style={stripBase}>
        <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>Migration status</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Compares the legacy roster against portal families - run when needed.
        </span>
        <button type="button" onClick={check} className="focus-ring" style={checkButton}>
          Check migration status
        </button>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div style={stripBase} aria-busy="true">
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Checking migration status…</span>
      </div>
    );
  }

  if (state === 'error' || !status) {
    return (
      <div style={stripBase}>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Couldn’t check migration status right now.</span>
        <button type="button" onClick={check} className="focus-ring" style={checkButton}>
          Try again
        </button>
      </div>
    );
  }

  const complete = status.missing === 0;

  return (
    <div style={{ ...stripBase, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: 99, flex: '0 0 auto',
            background: complete ? 'var(--ok)' : 'var(--warn)',
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>
          Migration status
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {status.migrated.toLocaleString()} of {status.legacyTotal.toLocaleString()} legacy families migrated
          {status.missing > 0 && (
            <> · <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{status.missing.toLocaleString()} not yet in portal</span></>
          )}
        </span>
        {status.missing > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="focus-ring"
            style={{
              marginLeft: 'auto', minHeight: 44, padding: '0 8px',
              background: 'transparent', border: 0, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: 'var(--accentDeep)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'Show'} missing
            <span style={{ display: 'inline-flex', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <SetuIcon.chevron color="var(--accentDeep)" />
            </span>
          </button>
        )}
      </div>

      {expanded && status.missingFids.length > 0 && (
        <div
          style={{
            marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)',
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}
        >
          {status.missingFids.map((fid) => (
            <span
              key={fid}
              style={{
                fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
                padding: '2px 8px', background: 'var(--surface2)',
                border: '1px solid var(--line)', borderRadius: 99,
              }}
            >
              {fid}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const stripBase = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 14px',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  flexWrap: 'wrap',
} as const;

const checkButton = {
  marginLeft: 'auto', minHeight: 44, padding: '0 12px',
  background: 'transparent', border: '1px solid var(--line2)', borderRadius: 999,
  cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accentDeep)',
  whiteSpace: 'nowrap',
} as const;
