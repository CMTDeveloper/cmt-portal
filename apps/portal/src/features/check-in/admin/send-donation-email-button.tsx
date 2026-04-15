'use client';
import { useState, useTransition } from 'react';
import { Button } from '@cmt/ui';

interface Props {
  email: string;
  familyName: string;
}

export function SendDonationEmailButton({ email, familyName }: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  return (
    <>
      <Button
        type="button"
        disabled={pending || status === 'sent'}
        onClick={() =>
          startTransition(async () => {
            const res = await fetch('/api/check-in/notifications/send-email', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                to: email,
                template: 'donation-thank-you',
                props: { familyName },
              }),
            });
            setStatus(res.ok ? 'sent' : 'error');
          })
        }
      >
        {pending ? 'Sending…' : status === 'sent' ? 'Sent' : 'Send donation email'}
      </Button>
      {status === 'error' && <span role="alert" className="ml-2 text-xs text-red-600">Failed</span>}
    </>
  );
}
