'use client';

import { ErrorFallback } from '@cmt/ui';

export default function WelcomeReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Welcome · Reports" />;
}
