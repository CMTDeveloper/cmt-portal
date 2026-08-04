'use client';
import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';
export default function GuestError({ error, reset }: { error: Error; reset: () => void }) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Guest check-in" />;
}
