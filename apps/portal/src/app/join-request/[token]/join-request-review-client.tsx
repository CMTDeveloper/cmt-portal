'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast, SetuAvatar } from '@cmt/ui';
import {
  getJoinRequestClient,
  approveJoinRequestClient,
  declineJoinRequestClient,
  type JoinRequestMetadata,
} from '@/features/setu/join-request';

interface Props {
  token: string;
  // Mobile branch passes compact for tighter sizing; desktop omits it.
  compact?: boolean;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ok'; meta: JoinRequestMetadata }
  | { kind: 'error'; code: 'expired' | 'not-found' | 'forbidden' }
  | { kind: 'approved' }
  | { kind: 'declined' };

// The approve page is reached from the manager's emailed link. The GET is
// manager-only + fid-scoped server-side; if the visitor has no manager session
// the route returns 401/403 → we send them to sign in and back. Approve/decline
// promote/close the matched member's join request; we do NOT mint anyone's
// session here (the requester signs in later once approved).
export function JoinRequestReviewClient({ token, compact = false }: Props) {
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await getJoinRequestClient(token);
    if ('error' in result) {
      if (result.error === 'forbidden') {
        // No (or wrong) manager session — prove it via sign-in, then return.
        window.location.href = `/sign-in?from=/join-request/${encodeURIComponent(token)}`;
        return;
      }
      setView({ kind: 'error', code: result.error });
      return;
    }
    if (result.status !== 'pending') {
      setView({ kind: result.status === 'approved' ? 'approved' : 'declined' });
      return;
    }
    setView({ kind: 'ok', meta: result });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove() {
    setBusy(true);
    const result = await approveJoinRequestClient(token);
    if (result.ok) {
      toast.success('Approved — they can now manage your family.');
      setView({ kind: 'approved' });
    } else {
      toast.error(errorMessage(result.error));
    }
    setBusy(false);
  }

  async function handleDecline() {
    setBusy(true);
    const result = await declineJoinRequestClient(token);
    if (result.ok) {
      toast.success('Request declined.');
      setView({ kind: 'declined' });
    } else {
      toast.error(errorMessage(result.error));
    }
    setBusy(false);
  }

  if (view.kind === 'loading') {
    return <p style={{ fontSize: 14, color: 'var(--muted)' }}>Loading request…</p>;
  }

  if (view.kind === 'error') {
    const headline =
      view.code === 'expired' ? 'This request has expired' : 'Request not found';
    const body =
      view.code === 'expired'
        ? 'Ask them to send a new request from the registration page.'
        : 'This request link is invalid or has already been handled.';
    return (
      <>
        <h2 style={{ fontSize: compact ? 24 : 30, fontWeight: 400, marginBottom: 12 }}>{headline}</h2>
        <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 24 }}>{body}</p>
        <Link href="/family" className="btn btn--p btn--block" style={{ display: 'flex' }}>Go to my family →</Link>
      </>
    );
  }

  if (view.kind === 'approved' || view.kind === 'declined') {
    const approved = view.kind === 'approved';
    return (
      <>
        <h2 style={{ fontSize: compact ? 24 : 30, fontWeight: 400, marginBottom: 12 }}>
          {approved ? 'Request approved' : 'Request declined'}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 24 }}>
          {approved
            ? 'They can now sign in and help manage your family. No further action needed.'
            : 'No changes were made to your family. They have not been given access.'}
        </p>
        <Link href="/family" className="btn btn--p btn--block" style={{ display: 'flex' }}>Go to my family →</Link>
      </>
    );
  }

  const { meta } = view;
  const name = meta.requesterName?.trim() || meta.requesterEmail;

  return (
    <>
      <div style={{ alignSelf: 'flex-start', padding: '4px 10px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontSize: 11, fontWeight: 600, marginBottom: 18 }}>
        Join request
      </div>
      <h2 style={{ fontSize: compact ? 26 : 32, fontWeight: 400, lineHeight: 1.15, marginBottom: 14 }}>
        <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{name}</em> wants to join the {meta.familyName} family.
      </h2>
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 22 }}>
        Approve to make them a co-manager — they&apos;ll be able to manage{' '}
        <em className="sa">Bala Vihar</em> enrollment, attendance, and donations for your household.
      </p>
      <div style={{ padding: 18, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 22 }}>
        <div className="row" style={{ gap: 10 }}>
          <SetuAvatar name={name} size={36} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.requesterEmail}</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="btn btn--p btn--block"
        style={{ marginBottom: 10, display: 'flex', ...(compact ? {} : { padding: '14px 22px' }) }}
        onClick={handleApprove}
        disabled={busy}
      >
        {busy ? 'Working…' : 'Approve & add as co-manager →'}
      </button>
      <button
        type="button"
        className="btn btn--g btn--block"
        style={{ fontSize: 13 }}
        onClick={handleDecline}
        disabled={busy}
      >
        Decline request
      </button>
    </>
  );
}

function errorMessage(code: string): string {
  const map: Record<string, string> = {
    expired: 'That request has expired.',
    'not-found': 'That request no longer exists.',
    'already-resolved': 'That request was already handled.',
    forbidden: 'You can only review requests for your own family.',
    network: 'Network error. Check your connection and try again.',
  };
  return map[code] ?? 'Something went wrong. Please try again.';
}
