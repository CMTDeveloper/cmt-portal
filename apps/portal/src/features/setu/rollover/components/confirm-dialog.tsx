'use client';

import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  promoted: number;
  fromYear: string;
  toYear: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirm modal for the irreversible promotion commit. Rendered in a
 * fixed overlay OUTSIDE the page's CspRoot, so it MUST carry `className="csp"`
 * itself or the Setu brand tokens (--ink, --surface, --accent…) resolve to
 * nothing and the dialog renders unstyled. Mobile-friendly: the card is
 * width-capped but full-bleed-padded on small screens, buttons stack full-width.
 */
export function ConfirmDialog({ promoted, fromYear, toYear, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Esc to cancel; focus the destructive action on mount for keyboard users.
  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="csp"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rollover-confirm-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        background: 'rgba(15,26,34,0.42)',
      }}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius, 16px)',
          padding: 22,
          boxShadow: '0 24px 60px rgba(15,26,34,0.28)',
        }}
      >
        <h2
          id="rollover-confirm-title"
          style={{ fontSize: 19, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1.25 }}
        >
          Promote {promoted} students to {toYear}?
        </h2>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.55 }}>
          This advances grades and closes the {fromYear} enrollments. History is preserved. This can&rsquo;t be
          undone with one click.
        </p>
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            flexDirection: 'row-reverse',
          }}
        >
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn btn--p"
            style={{ flex: '1 1 160px', minHeight: 46, fontSize: 15, fontWeight: 600, opacity: busy ? 0.65 : 1 }}
          >
            {busy ? 'Promoting…' : 'Promote'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn--g"
            style={{ flex: '1 1 120px', minHeight: 46, fontSize: 15, fontWeight: 500 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
