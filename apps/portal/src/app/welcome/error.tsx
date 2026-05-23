'use client';

import { ErrorFallback } from '@cmt/ui';

export default function WelcomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Welcome" />;
}
