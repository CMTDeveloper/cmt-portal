'use client';

import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';

export default function SchoolYearError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ReportingErrorFallback error={error} reset={reset} feature="School year rollover" />;
}
