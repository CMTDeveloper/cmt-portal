'use client';

import * as React from 'react';

interface ErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  feature?: string;
}

export function ErrorFallback({ error, reset, feature }: ErrorFallbackProps) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[ErrorFallback]', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="container mx-auto flex min-h-[40vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <h2 className="font-serif text-2xl text-heading">
        {feature ? `Something went wrong in ${feature}` : 'Something went wrong'}
      </h2>
      <p className="text-muted-foreground">
        We hit an unexpected error. The rest of the portal is still working — you can try this
        section again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition hover:bg-primary/90"
      >
        Try again
      </button>
      {error.digest && <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>}
    </div>
  );
}
