'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dismissContactsNudge } from '@/features/setu/contacts/contacts-client';

export function ContactsNudge() {
  const [hidden, setHidden] = useState(false);

  async function handleDismiss() {
    setHidden(true);
    // Fire-and-forget persistence; the local hide is the user-facing effect.
    await dismissContactsNudge().catch(() => {});
  }

  if (hidden) return null;

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--accentSoft)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius)',
        marginBottom: 18,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accentDeep)' }}>
          Add the other emails and phones you use
        </div>
        <div style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 2, lineHeight: 1.5 }}>
          So we always recognize you and never create a duplicate family record.
        </div>
        <Link
          href="/family/settings/contacts"
          className="btn btn--s"
          style={{ marginTop: 10, display: 'inline-block', textDecoration: 'none' }}
        >
          Add contacts →
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{ background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4 }}
      >
        ×
      </button>
    </div>
  );
}
