'use client';

import { useState, Fragment } from 'react';
import { SetuLogo, toast } from '@cmt/ui';
import type { DisclaimerSection } from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { navigateTo } from '@/features/setu/members/navigate-to';
import { acceptDisclaimersClient } from '../disclaimers-client';

/** Render text with http(s) URLs turned into links; everything else is plain. */
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accentDeep)', textDecoration: 'underline' }}>
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Acknowledgements screen. The family reads the intro + value sections + the
 * acknowledgement statement, ticks a single box, and confirms with one
 * "I Acknowledge" action (mirrors the printed CMT Bala Vihar Acknowledgements).
 * On submit it records acceptance and leaves via a HARD navigation to /family
 * (never router.push) so the /family gate re-runs server-side on fresh data.
 */
export function DisclaimerAcceptForm({
  sections,
  intro,
  acknowledgement,
}: {
  sections: DisclaimerSection[];
  intro?: string;
  acknowledgement?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acknowledged || saving) return;
    setSaving(true);
    try {
      await acceptDisclaimersClient();
    } catch {
      toast.error('Something went wrong saving your acknowledgement. Please try again.');
      setSaving(false);
      return;
    }
    // Leave via a hard navigation; keep saving=true (the page is unloading).
    navigateTo('/family');
  }

  const body = (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px 40px' }}>
      <div style={{ marginBottom: 26 }}><SetuLogo size={22} /></div>
      <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Before you continue
      </p>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>
        Acknowledgements
      </h1>

      {intro?.trim() && (
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
          {linkify(intro)}
        </p>
      )}
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5, marginBottom: 22 }}>
        Please read the following before acknowledging.
      </p>

      {sections.map((s) => (
        <div key={s.id} className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span aria-hidden style={{ fontSize: 15 }}>🪷</span>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accentDeep)' }}>{s.title}</div>
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--body-text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{s.body}</p>
        </div>
      ))}

      {acknowledgement?.trim() && (
        <div className="card" style={{ padding: 18, marginBottom: 16, background: 'var(--accentSoft)', borderColor: 'var(--accent)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--accentDeep)', marginBottom: 8 }}>
            Acknowledgement
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--body-text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{acknowledgement}</p>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13.5, marginBottom: 16, lineHeight: 1.5 }}>
        <input
          type="checkbox"
          data-testid="disclaimer-ack-checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
        />
        On behalf of my family, I confirm that I have read and agree to the above.
      </label>

      <button
        type="submit"
        className="btn btn--p btn--block"
        data-testid="disclaimers-accept"
        disabled={!acknowledged || saving}
      >
        {saving ? 'Saving…' : 'I Acknowledge'}
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <CspRoot style={{ minHeight: '100dvh' }}>{body}</CspRoot>
    </form>
  );
}
