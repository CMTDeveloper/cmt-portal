'use client';

import { useEffect, useState } from 'react';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Multi-select picker for a member's volunteering skills. Fetches the
 * admin-managed option list from /api/setu/volunteering-skills and renders each
 * as a toggleable chip.
 *
 * No silent data loss: any value the member already has that is NOT in the
 * current admin list is still shown (and selected), so saving keeps it.
 */
export function VolunteeringSkillsPicker({ value, onChange }: Props) {
  const [options, setOptions] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/setu/volunteering-skills', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : { options: [] }))
      .then((data: { options?: unknown }) => {
        if (!active) return;
        const opts = Array.isArray(data.options)
          ? data.options.filter((o): o is string => typeof o === 'string')
          : [];
        setOptions(opts);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Admin options first, then any already-selected value not in the list.
  const extras = value.filter((v) => !options.includes(v));
  const display = [...options, ...extras];

  function toggle(skill: string) {
    if (value.includes(skill)) {
      onChange(value.filter((v) => v !== skill));
    } else {
      onChange([...value, skill]);
    }
  }

  if (loaded && display.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        No volunteering options have been set up yet.
      </p>
    );
  }

  return (
    <div role="group" aria-label="Volunteering skills" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {display.map((skill) => {
        const selected = value.includes(skill);
        return (
          <button
            key={skill}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(skill)}
            style={{
              padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: '1px solid',
              borderColor: selected ? 'var(--accent)' : 'var(--line2)',
              background: selected ? 'var(--accentSoft)' : 'var(--surface)',
              color: selected ? 'var(--accentDeep)' : 'var(--body-text)',
            }}
          >
            {skill}
          </button>
        );
      })}
    </div>
  );
}
