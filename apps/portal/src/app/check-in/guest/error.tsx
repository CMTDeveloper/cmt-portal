'use client';
import { ErrorFallback } from '@cmt/ui';
export default function GuestError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} feature="Guest check-in" />;
}
