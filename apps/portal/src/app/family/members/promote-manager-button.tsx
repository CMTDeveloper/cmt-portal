'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SetuIcon, toast } from '@cmt/ui';

interface Props {
  mid: string;
  name: string;
  /** Mobile list renders a compact full-width row; desktop renders an inline button. */
  variant: 'desktop' | 'mobile';
}

/**
 * "Make manager" action surfaced on the My family roster for members who are
 * not yet managers. Promoting is deliberate: a confirm step gates the PATCH so
 * it can't happen on a single accidental click. The API
 * (PATCH /api/setu/members/{mid}) enforces manager-only + last-manager guards;
 * this component only surfaces errors, it does not reimplement those guards.
 */
export function PromoteManagerButton({ mid, name, variant }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function promote() {
    setSaving(true);
    try {
      const res = await fetch(`/api/setu/members/${mid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ manager: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data?.error ?? 'Could not make this member a manager. Try again.');
        return;
      }
      toast.success(`${name} is now a family manager`);
      setConfirming(false);
      router.refresh();
    } catch {
      toast.error('Network error. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (variant === 'mobile') {
    if (confirming) {
      return (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn--p"
            style={{ flex: 1, padding: '8px 10px', fontSize: 12 }}
            onClick={promote}
            disabled={saving}
          >
            {saving ? 'Making…' : `Make ${name} a manager`}
          </button>
          <button
            type="button"
            className="btn btn--g"
            style={{ padding: '8px 10px', fontSize: 12 }}
            onClick={() => setConfirming(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="btn btn--s"
        style={{ width: '100%', marginTop: 8, padding: '8px 10px', fontSize: 12, justifyContent: 'center' }}
        onClick={() => setConfirming(true)}
      >
        <SetuIcon.shield /> Make manager
      </button>
    );
  }

  // Desktop
  if (confirming) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn--p"
          style={{ padding: '6px 10px', fontSize: 12 }}
          onClick={promote}
          disabled={saving}
        >
          {saving ? 'Making…' : 'Confirm'}
        </button>
        <button
          type="button"
          className="btn btn--g"
          style={{ padding: '6px 10px', fontSize: 12 }}
          onClick={() => setConfirming(false)}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--s"
      style={{ padding: '6px 10px', fontSize: 12 }}
      onClick={() => setConfirming(true)}
    >
      <SetuIcon.shield /> Make manager
    </button>
  );
}
