'use client';
import { useTransition } from 'react';
import { Button } from '@cmt/ui';

interface Props {
  kind: 'check-ins' | 'guests';
  label: string;
}

export function ReportExportButton({ kind, label }: Props) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await fetch(`/api/check-in/admin/reports/${kind}`, { method: 'POST' });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button type="button" onClick={onClick} disabled={pending}>
      {pending ? 'Exporting…' : label}
    </Button>
  );
}
