'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { ErrorFallback } from '@cmt/ui';

/**
 * The error boundary body for EVERY route segment. Reports, then renders.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * 🔴 On 2026-08-03 a real family sent a screenshot of "Something went wrong"
 * and said *"I hit this error often and have to refresh"*. We had no record of
 * it. Not a sampling gap - a structural one: of the 45 error boundaries under
 * `src/app`, **44 reported nothing at all**. Only `global-error.tsx` called
 * `Sentry.captureException`, and that boundary fires only when the ROOT LAYOUT
 * throws, which is rare. Every ordinary crash landed in a silent boundary.
 *
 * A React error boundary SWALLOWS the error - it never reaches `window.onerror`
 * or `onunhandledrejection`, so Sentry's global handlers cannot see it either.
 * Explicit capture in the boundary is the only thing that works.
 *
 * That blindness is why issue #62 ("/family collapsed layout") sat open from
 * 2026-07-10 with no diagnosis: the layout comment in app/family/layout.tsx
 * names catching the hydration error as the NEXT STEP, and the instrumentation
 * to catch it was never wired.
 *
 * ── Why a wrapper and not a prop on ErrorFallback ───────────────────────────
 * `@cmt/ui` is a pure presentation package with no observability dependency,
 * and it should stay that way - `packages/ui` is consumed by surfaces that have
 * no Sentry. Reporting is an app concern, so it lives in the app. An optional
 * `onError` prop on ErrorFallback would have re-created the exact failure this
 * fixes: something each of 45 callers has to remember to pass.
 *
 * ⚠️ Every `error.tsx` under `src/app` MUST use this, not `ErrorFallback`
 * directly. That is pinned by `src/__tests__/error-boundaries-report.test.ts`,
 * which reads the files - change the rule there, not just here.
 */
export function useReportBoundaryError(error: Error & { digest?: string }, feature?: string): void {
  useEffect(() => {
    // `feature` as a tag, not baked into the message, so Sentry groups by the
    // real fault and the segment stays filterable.
    Sentry.captureException(error, {
      tags: {
        boundary: feature ?? 'root',
        // A server error carries a digest; a CLIENT error never does. That one
        // bit separates "our handler threw" from "the browser could not run the
        // page it was given" (hydration mismatch, missing chunk after a
        // deploy), and they need completely different investigations. The
        // family's screenshot showed NO Error ID, which is how we knew hers was
        // client-side before reading a single line of the stack.
        errorSide: error.digest ? 'server' : 'client',
      },
    });
  }, [error, feature]);
}

export function ReportingErrorFallback({
  error,
  reset,
  feature,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  feature?: string;
}) {
  useReportBoundaryError(error, feature);

  return <ErrorFallback error={error} reset={reset} {...(feature ? { feature } : {})} />;
}
