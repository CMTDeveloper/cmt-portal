'use client';
import { ReportingErrorFallback } from '@/components/chrome/reporting-error-fallback';
export default function CheckInReportError({ error, reset }: { error: Error; reset: () => void }) {
  return <ReportingErrorFallback error={error} reset={reset} feature="Sunday Attendance Overview" />;
}
