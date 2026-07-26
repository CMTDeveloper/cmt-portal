'use client';

import { ErrorFallback } from '@cmt/ui';

export default function AdultClassError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Adult Study Class" />;
}
