'use client';

import type { OfferingDoc } from '@cmt/shared-domain';

interface OfferingPickerProps {
  offerings: OfferingDoc[];
  selectedOid: string | null;
  onSelect: (oid: string) => void;
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
}

/**
 * Offering picker for the parameterised enroll page.
 *
 * With ONE offering → auto-selected, displays term label only (no radio UI).
 * With MULTIPLE offerings → radio list for the family to pick.
 */
export function OfferingPicker({ offerings, selectedOid, onSelect }: OfferingPickerProps) {
  if (offerings.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
        No open offerings available.
      </div>
    );
  }

  if (offerings.length === 1) {
    const o = offerings[0]!;
    return (
      <div style={{
        padding: '14px 16px',
        background: 'var(--accentSoft)',
        borderRadius: 'var(--radius)',
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)' }}>{o.termLabel}</div>
        {(o.startDate || o.endDate) && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {fmtDate(o.startDate)}{o.endDate ? ` – ${fmtDate(o.endDate)}` : ''}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {offerings.map((o) => (
        <label
          key={o.oid}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '12px 14px',
            background: selectedOid === o.oid ? 'var(--accentSoft)' : 'var(--surface)',
            border: `1px solid ${selectedOid === o.oid ? 'var(--accent)' : 'var(--line)'}`,
            borderRadius: 'var(--radiusSm)',
            marginBottom: 8,
            cursor: 'pointer',
          }}
        >
          <input
            type="radio"
            name="offering"
            value={o.oid}
            checked={selectedOid === o.oid}
            onChange={() => onSelect(o.oid)}
            style={{ marginTop: 2, accentColor: 'var(--accent)' }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{o.termLabel}</div>
            {(o.startDate || o.endDate) && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {fmtDate(o.startDate)}{o.endDate ? ` – ${fmtDate(o.endDate)}` : ''}
              </div>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}
