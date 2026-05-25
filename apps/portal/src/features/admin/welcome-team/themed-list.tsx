'use client';
import { useState, useTransition } from 'react';
import { toast } from '@cmt/ui';

interface User { uid: string; email: string }

export function ThemedWelcomeTeamList({ users }: { users: User[] }) {
  const [list, setList] = useState(users);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRevoke(user: User) {
    if (!confirm(`Revoke welcome-team from ${user.email}?`)) return;
    setRevoking(user.uid);
    startTransition(async () => {
      const res = await fetch(`/api/admin/welcome-team/${user.uid}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Revoke failed: ${body.error ?? 'unknown'}`);
        setRevoking(null);
        return;
      }
      setList((prev) => prev.filter((u) => u.uid !== user.uid));
      setRevoking(null);
    });
  }

  if (list.length === 0) {
    return (
      <div style={{ padding: 22, background: 'var(--surface)', border: '1px dashed var(--line2)', borderRadius: 'var(--radius)', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        No welcome-team volunteers yet. Grant access using the form on the left.
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 8 }}>
      {list.map((u) => (
        <div key={u.uid} className="between" style={{
          padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{u.email || '(no email on record)'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.uid}</div>
          </div>
          <button
            onClick={() => handleRevoke(u)}
            disabled={pending && revoking === u.uid}
            style={{
              background: 'transparent', border: '1px solid var(--err)', color: 'var(--err)',
              padding: '6px 12px', borderRadius: 'var(--radiusSm)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'var(--body)',
            }}
          >
            {pending && revoking === u.uid ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      ))}
    </div>
  );
}
