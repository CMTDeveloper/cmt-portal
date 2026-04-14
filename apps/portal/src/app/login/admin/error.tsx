'use client';
import { ErrorFallback } from '@cmt/ui';

export default function AdminLoginError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} feature="Admin sign-in" />;
}
