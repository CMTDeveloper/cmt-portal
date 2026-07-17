'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';

/**
 * Cancels a still-pending co-manager invite (deletes the pending member + the
 * invite). Manager-only; the route enforces it too. Keyed by the pending
 * member's mid — the members list has that, not the opaque invite token.
 */
export function CancelInviteButton({ mid, name, variant }: { mid: string; name: string; variant: 'mobile' | 'desktop' }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  function cancelInvite() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/invite/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ mid }),
        });
        if (!res.ok) {
          toast.error('Could not cancel the invite. Please try again.');
          return;
        }
        toast.success(`Invite to ${name || 'this person'} cancelled.`);
        router.refresh();
      } catch {
        toast.error('Network error. Check your connection and try again.');
      } finally {
        setConfirming(false);
      }
    });
  }

  const base: React.CSSProperties =
    variant === 'mobile'
      ? { width: '100%', marginTop: 8, padding: '10px 12px', fontSize: 13 }
      : { padding: '6px 10px', fontSize: 12 };

  if (!confirming) {
    return (
      <button type="button" className="btn btn--g" style={base} onClick={() => setConfirming(true)} disabled={pending}>
        Cancel invite
      </button>
    );
  }
  return (
    <div className="row" style={{ gap: 8, marginTop: variant === 'mobile' ? 8 : 0 }}>
      <button
        type="button"
        className="btn"
        style={{ ...base, background: 'var(--err)', color: '#fff', border: '1px solid var(--err)' }}
        onClick={cancelInvite}
        disabled={pending}
      >
        {pending ? 'Cancelling…' : 'Confirm cancel'}
      </button>
      <button type="button" className="btn btn--g" style={base} onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </button>
    </div>
  );
}
