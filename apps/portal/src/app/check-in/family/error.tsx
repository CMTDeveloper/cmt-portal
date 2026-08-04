'use client';

import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';

export default function FamilyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Family dashboard" />;
}
