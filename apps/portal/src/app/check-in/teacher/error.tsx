'use client';
import { ErrorFallback } from '@cmt/ui';
export default function TeacherError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Teacher dashboard error" />;
}
