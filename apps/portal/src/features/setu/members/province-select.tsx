'use client';

import { CANADIAN_PROVINCES } from '@cmt/shared-domain';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

/**
 * Single-select for a family's home-address province. Renders the fixed
 * CANADIAN_PROVINCES list plus, if the current value is a non-empty code not in
 * that list (legacy/free-text data), an extra selected option so saving never
 * silently drops it (mirrors relation-select's `extras` handling).
 */
export function ProvinceSelect({ value, onChange }: Props) {
  const extras =
    value && !CANADIAN_PROVINCES.some((p) => p.code === value) ? [value] : [];

  return (
    <select
      className="input"
      aria-label="Province"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Select province…
      </option>
      {CANADIAN_PROVINCES.map((p) => (
        <option key={p.code} value={p.code}>
          {p.name}
        </option>
      ))}
      {extras.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
