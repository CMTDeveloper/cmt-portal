'use client';
import { ErrorFallback } from '@cmt/ui';
export default function UninformedError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} feature="Uninformed page error" />;
}
