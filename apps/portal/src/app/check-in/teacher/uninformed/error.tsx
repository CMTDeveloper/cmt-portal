'use client';
import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';
export default function UninformedError({ error, reset }: { error: Error; reset: () => void }) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Uninformed page error" />;
}
