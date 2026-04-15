'use client';
import { ErrorFallback } from '@cmt/ui';
export default function ReportError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Report error" />;
}
