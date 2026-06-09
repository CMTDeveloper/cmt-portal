'use client';

import { ErrorFallback } from '@cmt/ui';

export default function UsersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Users & roles" />;
}
