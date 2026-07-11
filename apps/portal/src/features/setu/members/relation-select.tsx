'use client';

import { FAMILY_RELATION_OPTIONS } from '@cmt/shared-domain';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

/**
 * Single-select for a family-level emergency contact's relation. Renders the
 * admin-fixed FAMILY_RELATION_OPTIONS plus, if the current value is a non-empty
 * relation not in that list (legacy/free-text data), an extra selected option
 * so saving never silently drops it (mirrors the volunteering-skills-picker's
 * `extras` handling).
 */
export function RelationSelect({ value, onChange }: Props) {
  const extras =
    value && !(FAMILY_RELATION_OPTIONS as readonly string[]).includes(value) ? [value] : [];

  return (
    <select
      className="input"
      aria-label="Relation"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Select relation…
      </option>
      {FAMILY_RELATION_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
      {extras.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}
