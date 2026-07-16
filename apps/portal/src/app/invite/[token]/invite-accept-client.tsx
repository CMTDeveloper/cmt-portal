'use client';

import { useEffect, useState } from 'react';
import { toast } from '@cmt/ui';
import { acceptInviteClient } from '@/features/setu/invite/accept-invite-client';

interface Props {
  token: string;
  mobile?: boolean;
  // True when the invitee has just returned from sign-in (the page carries
  // ?intent=accept). We then accept automatically — clicking the emailed link +
  // signing in is enough, no second "Accept & join" click (Vaibhav's report).
  autoAccept?: boolean;
}

// Module-level, shared by the mobile + desktop copies of this component that the
// invite page renders simultaneously — so the auto-accept fires EXACTLY once
// across both, never a double POST (the 2nd would 409 'already-accepted').
let autoAcceptStarted = false;

export function InviteAcceptClient({ token, mobile, autoAccept }: Props) {
  const [accepting, setAccepting] = useState(false);

  async function handleAccept() {
    setAccepting(true);
    try {
      const result = await acceptInviteClient(token);
      if (!result.ok) {
        if (result.error === 'no-session') {
          // Prove email ownership first (email-match is enforced server-side), then
          // come back to THIS invite with ?intent=accept so it completes itself.
          const dest = `/invite/${encodeURIComponent(token)}?intent=accept`;
          window.location.href = `/sign-in?from=${encodeURIComponent(dest)}`;
          return;
        }
        toast.error(errorMessage(result.error));
        setAccepting(false);
        return;
      }
      window.location.href = '/family';
    } catch {
      toast.error('Network error. Check your connection and try again.');
      setAccepting(false);
    }
  }

  useEffect(() => {
    // Fire once when autoAccept is set (the module guard makes it once across the
    // mobile + desktop copies). handleAccept only depends on `token` via closure.
    if (autoAccept && !autoAcceptStarted) {
      autoAcceptStarted = true;
      void handleAccept();
    }
  }, [autoAccept]);

  function errorMessage(code: string): string {
    const map: Record<string, string> = {
      'email-mismatch': 'Sign in with the email address this invite was sent to.',
      'contact-already-registered': 'This email is already linked to another family. Contact the family manager.',
      expired: 'This invite has expired. Ask the family manager to send a new one.',
      'already-accepted': 'This invite has already been accepted.',
      'invite-not-found': 'Invite not found. The link may be wrong or it was revoked.',
    };
    return map[code] ?? 'Something went wrong. Please try again.';
  }

  return (
    <>
      <button
        className="btn btn--p btn--block"
        style={{ marginBottom: 10, display: 'flex', ...(mobile ? {} : { padding: '14px 22px' }) }}
        onClick={handleAccept}
        disabled={accepting}
      >
        {accepting ? 'Joining…' : 'Accept & join →'}
      </button>
      <button
        className="btn btn--g btn--block"
        style={{ fontSize: 13 }}
        disabled={accepting}
        onClick={() => { window.history.back(); }}
      >
        Decline this invite
      </button>
    </>
  );
}
