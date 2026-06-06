'use client';

import { useState } from 'react';
import { SetuIcon, toast } from '@cmt/ui';

/**
 * Admin editor for the volunteering-skill option list. Renders the current
 * options as removable chips, an "add option" field, and a Save button that
 * PUTs the list to /api/admin/volunteering-skills. The server trims, caps
 * length, and dedupes case-insensitively; we mirror the dedupe locally so the
 * admin gets immediate feedback when re-adding an existing option.
 */
export function SkillsEditor({ initialOptions }: { initialOptions: string[] }) {
  const [options, setOptions] = useState<string[]>(initialOptions);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function addOption() {
    const value = draft.trim();
    if (!value) return;
    if (options.some((o) => o.toLowerCase() === value.toLowerCase())) {
      toast.error('That option is already in the list');
      setDraft('');
      return;
    }
    setOptions((prev) => [...prev, value]);
    setDraft('');
  }

  function removeOption(target: string) {
    setOptions((prev) => prev.filter((o) => o !== target));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/volunteering-skills', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ options }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; options?: string[] };
      if (!res.ok) {
        toast.error(data.error ?? 'Save failed');
        return;
      }
      if (Array.isArray(data.options)) setOptions(data.options);
      toast.success('Volunteering skills saved');
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Options</label>

      {options.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          No options yet. Add at least one so families have something to choose from.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {options.map((o) => (
            <span
              key={o}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 12px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 999, fontSize: 13, fontWeight: 600 }}
            >
              {o}
              <button
                type="button"
                aria-label={`Remove ${o}`}
                onClick={() => removeOption(o)}
                className="focus-ring"
                style={{ background: 'transparent', border: 0, padding: 0, display: 'inline-flex', color: 'var(--accentDeep)', cursor: 'pointer' }}
              >
                <SetuIcon.x />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 18 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption();
            }
          }}
          placeholder="Add an option, e.g. Photography"
          maxLength={60}
          aria-label="New volunteering skill"
        />
        <button type="button" className="btn btn--s" onClick={addOption} disabled={!draft.trim()}>
          Add
        </button>
      </div>

      <button type="button" className="btn btn--p" onClick={save} disabled={saving} style={{ padding: '12px 28px' }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
