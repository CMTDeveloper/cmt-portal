'use client';

import { useState } from 'react';
import { SetuIcon, toast } from '@cmt/ui';

/**
 * Admin editor for the centre-location option list. Renders the current
 * locations as an ordered list with up/down reorder + remove controls, an
 * "add centre" field, and a Save button that PUTs the list to
 * /api/admin/locations. Order is meaningful - it drives the segmented location
 * filter elsewhere - so locations render as ordered rows rather than free-
 * floating chips. The server trims, dedupes case-insensitively, validates
 * non-empty, and runs the referential-safety guard; we mirror the dedupe
 * locally so the admin gets immediate feedback when re-adding an existing
 * centre. A 409 `location-in-use` means a centre still has records and cannot
 * be removed yet.
 */
export function LocationsEditor({ initialOptions }: { initialOptions: string[] }) {
  const [options, setOptions] = useState<string[]>(initialOptions);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function addOption() {
    const value = draft.trim();
    if (!value) return;
    if (options.some((o) => o.toLowerCase() === value.toLowerCase())) {
      toast.error(`${value} is already a centre.`);
      setDraft('');
      return;
    }
    setOptions((prev) => [...prev, value]);
    setDraft('');
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    setOptions((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/locations', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ options }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { location?: string; count?: number };
        toast.error(`${data.location ?? 'That centre'} still has ${data.count ?? 'some'} record(s) - reassign them before removing it.`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; options?: string[] };
      if (!res.ok) {
        toast.error(data.error ?? 'Save failed');
        return;
      }
      if (Array.isArray(data.options)) setOptions(data.options);
      toast.success('Locations saved');
    } catch {
      toast.error('Network error - please try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Centres</label>

      {options.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          No centres yet. Add at least one so families have somewhere to register.
        </p>
      ) : (
        <div className="col" style={{ gap: 8, marginBottom: 16 }}>
          {options.map((o, i) => (
            <div
              key={o}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px 8px 14px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600 }}
            >
              <span>{o}</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  aria-label={`Move ${o} up`}
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="focus-ring"
                  style={{ background: 'transparent', border: 0, padding: 4, display: 'inline-flex', color: 'var(--accentDeep)', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1 }}
                >
                  <SetuIcon.chevron style={{ transform: 'rotate(-90deg)' }} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${o} down`}
                  onClick={() => move(i, 1)}
                  disabled={i === options.length - 1}
                  className="focus-ring"
                  style={{ background: 'transparent', border: 0, padding: 4, display: 'inline-flex', color: 'var(--accentDeep)', cursor: i === options.length - 1 ? 'default' : 'pointer', opacity: i === options.length - 1 ? 0.35 : 1 }}
                >
                  <SetuIcon.chevron style={{ transform: 'rotate(90deg)' }} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${o}`}
                  onClick={() => removeOption(i)}
                  className="focus-ring"
                  style={{ background: 'transparent', border: 0, padding: 4, display: 'inline-flex', color: 'var(--accentDeep)', cursor: 'pointer' }}
                >
                  <SetuIcon.x />
                </button>
              </div>
            </div>
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
          placeholder="Add a centre, e.g. Mississauga"
          maxLength={60}
          aria-label="New centre location"
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
