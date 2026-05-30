'use client';
import { useState, useTransition } from 'react';
import { Button } from '@cmt/ui';

interface WelcomeTeamUser {
  uid: string;
  email: string;
}

interface Props {
  users: WelcomeTeamUser[];
}

export function WelcomeTeamList({ users }: Props) {
  const [list, setList] = useState(users);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRevoke(user: WelcomeTeamUser) {
    if (!confirm(`Revoke welcome-team from ${user.email}?`)) return;
    setError(null);
    setRevoking(user.uid);
    startTransition(async () => {
      const res = await fetch(`/api/check-in/admin/welcome-team/${user.uid}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`Failed to revoke ${user.email}: ${body.error ?? 'unknown'}`);
        setRevoking(null);
        return;
      }
      setList((prev) => prev.filter((u) => u.uid !== user.uid));
      setRevoking(null);
    });
  }

  if (list.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--foreground))]">
        No welcome-team users yet. Grant access to a volunteer using the form above.
      </p>
    );
  }

  return (
    <>
      {error && <div role="alert" className="mb-2 text-sm text-red-600">{error}</div>}

      {/* Mobile: stacked rows — one record per block with full-width Revoke button. */}
      <div className="block md:hidden">
        {list.map((u, i) => (
          <div
            key={u.uid}
            style={{
              padding: '14px 0',
              borderTop: i > 0 ? '1px solid hsl(var(--border))' : undefined,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                overflowWrap: 'anywhere',
                wordBreak: 'break-all',
                marginBottom: 4,
              }}
            >
              {u.email || '(no email on record)'}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'hsl(var(--foreground))',
                overflowWrap: 'anywhere',
                wordBreak: 'break-all',
                marginBottom: 12,
              }}
            >
              <code>{u.uid}</code>
            </div>
            <Button
              variant="outline"
              onClick={() => handleRevoke(u)}
              disabled={pending && revoking === u.uid}
              style={{ width: '100%' }}
            >
              {pending && revoking === u.uid ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        ))}
      </div>

      {/* Desktop: flex row with email+UID on the left, Revoke on the right. */}
      <ul className="hidden md:flex flex-col gap-2">
        {list.map((u) => (
          <li
            key={u.uid}
            className="flex items-center justify-between rounded border border-[hsl(var(--border))] p-3"
          >
            <div className="min-w-0 flex-1 mr-3">
              <div className="font-medium truncate">{u.email || '(no email on record)'}</div>
              <div className="text-xs text-[hsl(var(--foreground))]" style={{ overflowWrap: 'anywhere', wordBreak: 'break-all' }}><code>{u.uid}</code></div>
            </div>
            <Button
              variant="outline"
              onClick={() => handleRevoke(u)}
              disabled={pending && revoking === u.uid}
            >
              {pending && revoking === u.uid ? 'Revoking…' : 'Revoke'}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
