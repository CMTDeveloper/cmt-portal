'use client';

import { useRef, useState } from 'react';
import { toast } from '@cmt/ui';
import type { DisclaimerSection } from '@cmt/shared-domain/setu';
import { saveDisclaimersClient } from '@/features/setu/disclaimers/disclaimers-client';

/** Admin editor for the disclaimers content. Publishing bumps the content
 *  version (when changed) → all families re-accept on their next visit, so
 *  publish is behind an inline confirm. Edits the intro preamble, the value
 *  sections (add/remove/reorder-free), and the acknowledgement statement. */
export function DisclaimersEditor({
  initialIntro,
  initialSections,
  initialAcknowledgement,
  initialVersion,
}: {
  initialIntro: string;
  initialSections: DisclaimerSection[];
  initialAcknowledgement: string;
  initialVersion: number;
}) {
  const [intro, setIntro] = useState(initialIntro);
  const [sections, setSections] = useState<DisclaimerSection[]>(initialSections);
  const [acknowledgement, setAcknowledgement] = useState(initialAcknowledgement);
  const [version, setVersion] = useState(initialVersion);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const newIdCounter = useRef(0);

  function update(i: number, patch: Partial<DisclaimerSection>) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addSection() {
    newIdCounter.current += 1;
    setSections((prev) => [...prev, { id: `section-${Date.now()}-${newIdCounter.current}`, title: '', body: '' }]);
  }
  function removeSection(i: number) {
    setSections((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function publish() {
    setConfirming(false);
    setSaving(true);
    try {
      const next = await saveDisclaimersClient({ intro, sections, acknowledgement });
      setVersion(next);
      toast.success(`Published — version ${next}. Families will re-accept on their next visit.`);
    } catch {
      toast.error('Could not publish. Please check the fields and try again.');
    } finally {
      setSaving(false);
    }
  }

  const canPublish = sections.length > 0 && sections.every((s) => s.title.trim() && s.body.trim());

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Current published version: <strong>{version}</strong>
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="field">
          <label>Intro</label>
          <textarea
            className="input"
            data-testid="disclaimers-intro"
            rows={4}
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder="Preamble shown above the sections (e.g. Hari Om! …). Links are auto-detected."
          />
        </div>
      </div>

      {sections.map((s, i) => (
        <div key={s.id} className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Section {i + 1}</span>
            <button
              type="button"
              className="btn"
              data-testid={`disclaimers-remove-${i}`}
              onClick={() => removeSection(i)}
              disabled={saving || sections.length <= 1}
              style={{ fontSize: 12, padding: '4px 10px', color: 'var(--err)' }}
            >
              Remove
            </button>
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Section title</label>
            <input className="input" value={s.title} onChange={(e) => update(i, { title: e.target.value })} />
          </div>
          <div className="field">
            <label>Section text</label>
            <textarea
              className="input"
              rows={5}
              value={s.body}
              onChange={(e) => update(i, { body: e.target.value })}
              placeholder="One bullet per line, e.g. • Treat the ashram with care."
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn" data-testid="disclaimers-add-section" onClick={addSection} disabled={saving} style={{ marginBottom: 18 }}>
        + Add section
      </button>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="field">
          <label>Acknowledgement</label>
          <textarea
            className="input"
            data-testid="disclaimers-acknowledgement"
            rows={4}
            value={acknowledgement}
            onChange={(e) => setAcknowledgement(e.target.value)}
            placeholder="The binding statement shown above the “I Acknowledge” button."
          />
        </div>
      </div>

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
        <button
          type="button"
          className="btn btn--p"
          data-testid="disclaimers-publish"
          onClick={() => setConfirming(true)}
          disabled={saving || !canPublish}
          title={canPublish ? undefined : 'Every section needs a title and text.'}
        >
          Publish
        </button>
      )}
    </div>
  );
}
