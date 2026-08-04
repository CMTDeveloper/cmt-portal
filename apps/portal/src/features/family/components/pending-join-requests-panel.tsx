'use client';

import { useCallback, useState } from 'react';
import { toast, SetuAvatar } from '@cmt/ui';
import {
  listJoinRequestsClient,
  approveJoinRequestClient,
  declineJoinRequestClient,
  type JoinRequestListItem,
} from '@/features/setu/join-request';

interface Props {
  // Mobile branch passes compact for tighter spacing; desktop omits it.
  compact?: boolean;
  /**
   * The open requests, already read on the server.
   *
   * 🔴 REQUIRED for latency, not an optimisation. This panel used to fetch
   * `GET /api/setu/join-request` from a mount effect, and `/family` renders it
   * TWICE (a compact mobile copy and a desktop one, both in the DOM at once).
   * Measured against deployed preview on 2026-08-03, one dashboard load fired
   * FOUR identical calls to that endpoint, the slowest finishing 930ms after
   * navigation - on the page every family lands on, for data the server had
   * already authenticated the session to read.
   *
   * Passing it down instead means zero client round-trips, no empty-then-pop
   * flash, and both copies showing the same thing by construction rather than
   * by two requests happening to agree.
   */
  initialRequests: JoinRequestListItem[];
}

// Manager-only pending co-manager join requests. Renders NOTHING until at least
// one open request exists, so a manager with no pending requests sees no extra
// chrome. The parent /family page only mounts this for managers (claims.role ===
// 'family-manager'); the GET endpoint is also manager-gated server-side, so a
// non-manager that somehow mounts this just gets an empty list.
export function PendingJoinRequestsPanel({ compact = false, initialRequests }: Props) {
  const [requests, setRequests] = useState<JoinRequestListItem[]>(initialRequests);
  const [busyToken, setBusyToken] = useState<string | null>(null);

  // Re-read AFTER an approve/decline only. There is deliberately no mount
  // effect: the server already supplied the list, and fetching it again on
  // mount is what made one page load issue four identical requests.
  const refresh = useCallback(async () => {
    const result = await listJoinRequestsClient();
    if (result.ok) {
      setRequests(result.requests);
    }
    // On a non-ok (e.g. a family-member who isn't a manager) keep what we have
    // rather than blanking the panel — no error toast, this panel is
    // best-effort and the row the user just acted on is removed either way.
  }, []);

  async function handleApprove(token: string) {
    setBusyToken(token);
    const result = await approveJoinRequestClient(token);
    if (result.ok) {
      toast.success('Approved — they can now manage your family.');
      await refresh();
    } else {
      toast.error(errorMessage(result.error));
    }
    setBusyToken(null);
  }

  async function handleDecline(token: string) {
    setBusyToken(token);
    const result = await declineJoinRequestClient(token);
    if (result.ok) {
      toast.success('Request declined.');
      await refresh();
    } else {
      toast.error(errorMessage(result.error));
    }
    setBusyToken(null);
  }

  // Nothing to show when there is no open request. No "loaded" flag any more:
  // the server-supplied list is authoritative from the first paint, so an empty
  // array means empty rather than not-yet-known.
  if (requests.length === 0) return null;

  const pad = compact ? 16 : 24;

  return (
    <div
      className="card"
      data-testid="pending-join-requests"
      style={{ padding: pad, marginBottom: compact ? 12 : 18, borderColor: 'var(--accent)' }}
    >
      <div className="between" style={{ marginBottom: compact ? 12 : 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>
          Join requests · {requests.length}
        </h3>
        <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontSize: 11 }}>
          Needs your review
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
        Someone in your household asked to join and help manage your family. Approve to make them a
        co-manager, or decline.
      </p>
      <div className="col" style={{ gap: 10 }}>
        {requests.map((req) => {
          const name = req.requesterName?.trim() || req.requesterEmail;
          const isBusy = busyToken === req.token;
          return (
            <div
              key={req.token}
              data-testid="join-request-row"
              style={{
                padding: compact ? 12 : 14,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radiusSm)',
              }}
            >
              <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                <SetuAvatar name={name} size={compact ? 32 : 36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {req.requesterEmail}
                    {req.requesterPhone ? ` · ${req.requesterPhone}` : ''}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--p"
                  style={{ fontSize: 13, flex: 1 }}
                  onClick={() => handleApprove(req.token)}
                  disabled={isBusy}
                >
                  {isBusy ? 'Working…' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="btn btn--g"
                  style={{ fontSize: 13, flex: 1 }}
                  onClick={() => handleDecline(req.token)}
                  disabled={isBusy}
                >
                  Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function errorMessage(code: string): string {
  const map: Record<string, string> = {
    expired: 'That request has expired. Ask them to send a new one.',
    'not-found': 'That request no longer exists.',
    'already-resolved': 'That request was already handled.',
    forbidden: 'You can only review requests for your own family.',
    network: 'Network error. Check your connection and try again.',
  };
  return map[code] ?? 'Something went wrong. Please try again.';
}
