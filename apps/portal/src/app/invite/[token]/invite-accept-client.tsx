'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { acceptInviteClient } from '@/features/setu/invite/accept-invite-client';

interface Props {
  token: string;
  mobile?: boolean;
}

export function InviteAcceptClient({ token, mobile }: Props) {
  const [accepting, setAccepting] = useState(false);

  async function handleAccept() {
    setAccepting(true);
    try {
      const result = await acceptInviteClient(token);
      if (!result.ok) {
        if (result.error === 'no-session') {
          window.location.href = `/sign-in?from=/invite/${encodeURIComponent(token)}`;
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
