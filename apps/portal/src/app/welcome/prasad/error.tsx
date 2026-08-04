'use client';

import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';

export default function WelcomePrasadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Welcome · Prasad" />;
}
