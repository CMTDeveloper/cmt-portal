'use client';
import { ErrorFallback } from '@cmt/ui';
export default function AttendanceError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Attendance page error" />;
}
