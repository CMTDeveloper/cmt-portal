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
  /**
   * Adults who are teaching during that hour: shown, greyed out, labelled, and
   * NEVER pickable. Display only - `adults` remains the set that may be chosen,
   * and nothing here can enter `selected`.
   */
  teachingAdults: SelectableAdultView[];
}

/** The reason a greyed row is greyed. Named so the test asserts the real copy. */
export const TEACHING_NOTE = 'Teaching this hour';

/**
 * The selection itself. Multi-select, minimum one, preselected when there is
 * exactly one selectable adult (spec 4.4, scenario-matrix row 5).
 */
export function AdultClassForm({
  adults,
  initialSelected,
  bvPaid,
  teachingAdults,
}: AdultClassFormProps) {
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
      <div className="card" style={{ padding: 6, marginBottom: 14 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">Adults attending the Adult Study Class</legend>
          {adults.map((a, i) => (
            <label
              key={a.mid}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 12px',
                cursor: saving ? 'default' : 'pointer',
                fontSize: 15,
                borderTop: i === 0 ? undefined : '1px solid var(--line)',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(a.mid)}
                onChange={() => toggle(a.mid)}
                disabled={saving}
                style={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <span>{a.name}</span>
            </label>
          ))}

          {/* Teaching adults: present, greyed, and explained. They used to be
              omitted entirely, which left a two-parent household looking at one
              name and reading their own family record as broken. The checkbox is
              `disabled`, so it is neither checkable nor submitted, and `selected`
              can never contain one of these mids - the write route rejects them
              regardless (`mid-not-selectable`). */}
          {teachingAdults.map((a, i) => (
            <div
              key={a.mid}
              data-testid="teaching-adult"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 12px',
                fontSize: 15,
                color: 'var(--muted)',
                borderTop: adults.length === 0 && i === 0 ? undefined : '1px solid var(--line)',
              }}
            >
              <input
                type="checkbox"
                checked={false}
                disabled
                readOnly
                aria-label={`${a.name} - ${TEACHING_NOTE}`}
                style={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <span>{a.name}</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--accentDeep)',
                  background: 'var(--accentSoft)',
                  borderRadius: 999,
                  padding: '3px 9px',
                  whiteSpace: 'nowrap',
                }}
              >
                {TEACHING_NOTE}
              </span>
            </div>
          ))}
        </fieldset>
      </div>

      {teachingAdults.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 14px' }}>
          {teachingAdults.length === 1
            ? 'That adult is running a Bala Vihar class during the Adult Study Class, so they cannot attend it.'
            : 'Those adults are running Bala Vihar classes during the Adult Study Class, so they cannot attend it.'}
        </p>
      )}

      {!bvPaid && (
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 16px' }}>
          A suggested donation applies for the Adult Study Class. You can give after you continue.
        </p>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--err)', margin: '0 0 14px', lineHeight: 1.5 }}>
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
