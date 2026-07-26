'use client';

import { useState } from 'react';
import { Button } from '@cmt/ui';

export interface SelectableAdultView {
  mid: string;
  name: string;
}

export interface AdultClassFormProps {
  adults: SelectableAdultView[];
  /** Already-chosen mids, so re-visiting the screen shows the current answer. */
  initialSelected: string[];
  /** Whether Bala Vihar is paid - decides the fee line. */
  bvPaid: boolean;
}

/**
 * The selection itself. Multi-select, minimum one, preselected when there is
 * exactly one selectable adult (spec 4.4, scenario-matrix row 5).
 */
export function AdultClassForm({ adults, initialSelected, bvPaid }: AdultClassFormProps) {
  const [selected, setSelected] = useState<string[]>(() =>
    // Row 5: a single non-teaching parent has no decision to make - preselect
    // them so the family just confirms.
    initialSelected.length > 0 ? initialSelected : adults.length === 1 ? [adults[0]!.mid] : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(mid: string) {
    setSelected((prev) => (prev.includes(mid) ? prev.filter((m) => m !== mid) : [...prev, mid]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/setu/adult-class', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mids: selected }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(messageFor(body?.error));
        setSaving(false);
        return;
      }
      // HARD navigation, never router.push. /family is behind a redirect gate
      // that reads a `use cache` value we just invalidated; a soft push reads the
      // STALE value, bounces back here, and React preserves this component's
      // state - leaving the family stranded on "Saving…" forever.
      window.location.assign('/family');
    } catch {
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 24px' }}>
        <legend className="sr-only">Adults attending the Adult Study Class</legend>
        {adults.map((a) => (
          <label
            key={a.mid}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={selected.includes(a.mid)}
              onChange={() => toggle(a.mid)}
              disabled={saving}
            />
            <span>{a.name}</span>
          </label>
        ))}
      </fieldset>

      {!bvPaid && (
        <p style={{ marginBottom: 16 }}>
          A suggested donation applies for the Adult Study Class. You can give after you continue.
        </p>
      )}

      {error && (
        <p role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {/* Enabled/disabled purely from `selected` - never a pair of mutually
          exclusive conditions on visibility AND enablement, which is how a save
          button ends up unclickable in every state. */}
      <Button onClick={save} disabled={selected.length === 0 || saving}>
        {saving ? 'Saving…' : 'Continue'}
      </Button>
    </div>
  );
}

function messageFor(code: string | undefined): string {
  switch (code) {
    case 'mid-not-selectable':
      // Almost always a stale screen: someone was made a teacher, or left the
      // family, since this page rendered.
      return 'That choice is no longer available. Please refresh and pick again.';
    case 'no-adult-class-offering':
    case 'offering-disabled':
    case 'offering-expired':
    case 'program-not-available':
      return 'Registration for the Adult Study Class has closed. Please contact the centre.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
