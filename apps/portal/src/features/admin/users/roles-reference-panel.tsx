'use client';

import { ROLE_REFERENCE, ROLE_REFERENCE_ORDER } from '@/lib/auth/roles-reference';

// Standalone "What each role grants" reference, authored from canAccessRoute.
// Used on both the desktop and mobile Users & Roles screens.
export function RolesReferencePanel() {
  return (
    <div className="col" style={{ gap: 12 }}>
      {ROLE_REFERENCE_ORDER.map((role) => {
        const ref = ROLE_REFERENCE[role];
        return (
          <div
            key={role}
            style={{
              padding: '14px 16px',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>{ref.label}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
              {ref.summary}
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--body-text)', lineHeight: 1.55 }}>
              {ref.grants.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
