'use client';

import { useState } from 'react';
import { SetuIcon } from '@cmt/ui';
import { InviteModal } from './invite-modal';

export function MobileInviteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="focus-ring"
        style={{ width: '100%', padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}
        onClick={() => setOpen(true)}
      >
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accentSoft)', display: 'grid', placeItems: 'center', color: 'var(--accentDeep)' }}>
          <SetuIcon.mail/>
        </div>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Invite a co-manager</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Spouse or other parent can co-manage</div>
        </div>
        <SetuIcon.chevron color="var(--muted)"/>
      </button>
      <InviteModal open={open} onClose={() => setOpen(false)}/>
    </>
  );
}

export function DesktopInviteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn--s" onClick={() => setOpen(true)}>
        <SetuIcon.mail/> Invite co-manager
      </button>
      <InviteModal open={open} onClose={() => setOpen(false)}/>
    </>
  );
}
