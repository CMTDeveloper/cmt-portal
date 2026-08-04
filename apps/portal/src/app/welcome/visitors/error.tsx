'use client';

import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';

export default function WelcomeVisitorsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Welcome · Visitors" />;
}
