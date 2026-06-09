'use client';

import type { GrantableRole } from '@cmt/shared-domain';

// Small presentational chips for a staff person's effective roles. Pure —
// no client state — but kept in the 'use client' tree so it can sit inside
// the interactive list without a server/client boundary hop.

const ROLE_CHIP: Record<GrantableRole, { label: string; bg: string; fg: string }> = {
  admin: { label: 'Admin', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' },
  'welcome-team': { label: 'Welcome team', bg: 'var(--info-soft)', fg: 'var(--info-deep)' },
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
