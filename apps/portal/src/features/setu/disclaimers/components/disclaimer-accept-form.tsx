'use client';

import { useState } from 'react';
import { SetuLogo, toast } from '@cmt/ui';
import type { DisclaimerSection } from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { navigateTo } from '@/features/setu/members/navigate-to';
import { acceptDisclaimersClient } from '../disclaimers-client';

/**
 * Accept-all disclaimer screen. One required checkbox per section; the continue
 * button enables only when every box is checked. On submit it records acceptance
 * and leaves via a HARD navigation to /family (never router.push) so the /family
 * gate re-runs server-side on fresh data.
 */
export function DisclaimerAcceptForm({ sections }: { sections: DisclaimerSection[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const allChecked = sections.length > 0 && sections.every((s) => checked[s.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allChecked || saving) return;
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
        Our family agreement
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5, marginBottom: 22 }}>
        Please read and acknowledge each section to continue to your family dashboard.
      </p>

      {sections.map((s) => (
        <div key={s.id} className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accentDeep)', marginBottom: 6 }}>{s.title}</div>
          <p style={{ fontSize: 13.5, color: 'var(--body-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{s.body}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5 }}>
            <input
              type="checkbox"
              data-testid={`disclaimer-check-${s.id}`}
              checked={!!checked[s.id]}
              onChange={(e) => setChecked((prev) => ({ ...prev, [s.id]: e.target.checked }))}
              style={{ width: 18, height: 18 }}
            />
            I have read and agree to the above.
          </label>
        </div>
      ))}

      <button
        type="submit"
        className="btn btn--p btn--block"
        data-testid="disclaimers-accept"
        disabled={!allChecked || saving}
        style={{ marginTop: 8 }}
      >
        {saving ? 'Saving…' : 'Agree & continue'}
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <CspRoot style={{ minHeight: '100dvh' }}>{body}</CspRoot>
    </form>
  );
}
