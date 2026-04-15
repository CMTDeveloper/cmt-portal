'use client';
import { useState, useTransition } from 'react';
import { Button } from '@cmt/ui';

interface Props {
  uid: string;
  disabled?: boolean;
  onDone?: () => void;
}

export function DeleteAdminButton({ uid, disabled, onDone }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        disabled={disabled || pending}
        onClick={() => {
          if (!confirm('Delete this admin?')) return;
          startTransition(async () => {
            setError(null);
            const res = await fetch(`/api/check-in/admin/users/${uid}`, { method: 'DELETE' });
            if (!res.ok) {
              setError('Delete failed');
              return;
            }
            onDone?.();
          });
        }}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {error && <span role="alert" className="ml-2 text-xs text-red-600">{error}</span>}
    </>
  );
}
