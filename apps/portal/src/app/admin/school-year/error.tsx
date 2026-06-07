'use client';

import { ErrorFallback } from '@cmt/ui';

export default function SchoolYearError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="School year rollover" />;
}
