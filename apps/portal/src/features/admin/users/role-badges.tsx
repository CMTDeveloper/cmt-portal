'use client';

import type { GrantableRole } from '@cmt/shared-domain';

// Small presentational chips for a sevak's effective roles. Pure —
// no client state — but kept in the 'use client' tree so it can sit inside
// the interactive list without a server/client boundary hop.

/**
 * Display data for every grantable role, keyed by the role itself.
 *
 * EXPORTED (2026-08-06) so the desktop table, the filter chips and the
 * Add-sevak dialog all read their labels and colours from here instead of
 * hardcoding a subset. The `Record<GrantableRole, ...>` typing is the point: a
 * role added to GRANTABLE_ROLES fails to compile until it has display data, so
 * it cannot be grantable-but-invisible. `coordinator` was exactly that for weeks
 * - storable, savable, and absent from three hardcoded lists.
 */
export const ROLE_CHIP: Record<GrantableRole, { label: string; bg: string; fg: string }> = {
  admin: { label: 'Admin', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' },
  'welcome-team': { label: 'Welcome team', bg: 'var(--info-soft)', fg: 'var(--info-deep)' },
  coordinator: { label: 'Coordinator', bg: 'var(--ok-soft)', fg: 'var(--ok-deep)' },
};

export function RoleChip({ role }: { role: GrantableRole }) {
  const chip = ROLE_CHIP[role];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: chip.bg,
        color: chip.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        letterSpacing: '.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {chip.label}
    </span>
  );
}

export function TeacherBadge({ levels }: { levels: string[] }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: 'var(--setu-ok-soft, #d8ebdc)',
        color: 'var(--ok, #3d7a5a)',
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
      title={levels.length > 0 ? `Teaches: ${levels.join(', ')}` : 'Teacher'}
    >
      Teacher
      {levels.length > 0 && (
        <span style={{ fontWeight: 400, opacity: 0.85 }}>· {levels.join(', ')}</span>
      )}
    </span>
  );
}
