'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { DisclaimerSection } from '@cmt/shared-domain/setu';
import { saveDisclaimersClient } from '@/features/setu/disclaimers/disclaimers-client';

/** Admin editor for the disclaimer sections. Publishing bumps the content
 *  version (when changed) → all families re-accept on their next visit, so
 *  publish is behind an inline confirm. */
export function DisclaimersEditor({
  initialSections,
  initialVersion,
}: {
  initialSections: DisclaimerSection[];
  initialVersion: number;
}) {
  const [sections, setSections] = useState<DisclaimerSection[]>(initialSections);
  const [version, setVersion] = useState(initialVersion);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  function update(i: number, patch: Partial<DisclaimerSection>) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function publish() {
    setConfirming(false);
    setSaving(true);
    try {
      const next = await saveDisclaimersClient(sections);
      setVersion(next);
      toast.success(`Published — version ${next}. Families will re-accept on their next visit.`);
    } catch {
      toast.error('Could not publish. Please check the fields and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Current published version: <strong>{version}</strong>
      </p>

      {sections.map((s, i) => (
        <div key={s.id} className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Section title</label>
            <input
              className="input"
              value={s.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Section text</label>
            <textarea
              className="input"
              rows={4}
              value={s.body}
              onChange={(e) => update(i, { body: e.target.value })}
            />
          </div>
        </div>
      ))}

      {confirming ? (
        <div className="card" style={{ padding: 16, marginTop: 8, borderColor: 'var(--accent)' }}>
          <p style={{ fontSize: 13.5, marginBottom: 12 }}>
            Publishing will ask <strong>all families</strong> to re-accept on their next visit. Continue?
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--p" data-testid="disclaimers-publish-confirm" onClick={publish} disabled={saving}>
              {saving ? 'Publishing…' : 'Yes, publish'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--p" data-testid="disclaimers-publish" onClick={() => setConfirming(true)} disabled={saving}>
          Publish
        </button>
      )}
    </div>
  );
}
