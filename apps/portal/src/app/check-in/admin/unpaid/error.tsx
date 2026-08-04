'use client';
import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';
export default function UnpaidError({ error, reset }: { error: Error; reset: () => void }) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Unpaid families" />;
}
