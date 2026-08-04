// Sentry init for the browser. Next.js loads this automatically on the client.
// Session Replay and the user-feedback widget are intentionally NOT enabled:
// the portal renders family PII and we don't want to record DOM sessions or add
// a floating widget by default. Opt in later if needed.
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN } from './sentry.dsn';
import { SENTRY_DATA_COLLECTION, scrubSentryEvent } from './lib/sentry/scrub-event';

const isDev = process.env.NODE_ENV === 'development';

Sentry.init({
  dsn: SENTRY_DSN,

  // Send structured logs to Sentry.
  enableLogs: true,

  // Trace 100% of requests in dev, 10% in production.
  tracesSampleRate: isDev ? 1.0 : 0.1,

  // Privacy controls — shared with the server and edge inits. This runtime sees
  // whatever the user typed into a form before the error fired.
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});

// Instruments App Router client-side navigations for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

/**
 * Report React HYDRATION failures, which nothing else here can see.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * `881258b` pointed all 45 `error.tsx` boundaries at Sentry, and that was true
 * as far as it went. But the capture runs in a `useEffect`, so it only fires
 * once React has successfully COMMITTED the fallback. Two whole classes of
 * failure never get that far:
 *
 *   1. A hydration mismatch, which React reports through `onRecoverableError`
 *      and a `console.error` - never as a thrown exception, so Sentry's global
 *      handlers never see it either.
 *   2. A secondary crash while React is unwinding to FIND a boundary. Issue #62
 *      is exactly this - "Unexpected Suspense handler tag" is thrown from the
 *      reconciler while it is already handling a first failure - and it leaves
 *      no fallback and no record. It has been in Sentry since 2026-07-10 only
 *      in its milder form; the severe form is silent, and silent is what a
 *      family describes as "the page is just blank".
 *
 * ── Why patch console.error ─────────────────────────────────────────────────
 * Because that is the only channel React uses for these. Next's App Router does
 * not expose `hydrateRoot`'s `onRecoverableError` to app code, and these errors
 * are recovered rather than thrown, so `window.onerror` and `unhandledrejection`
 * both stay quiet.
 *
 * Narrow on purpose: it forwards EVERYTHING to the real console.error and only
 * reports messages carrying React's own signatures, capped per page load. A
 * broad console capture would turn every log line into a Sentry event and bury
 * the signal we are adding this for.
 */
const REACT_FAILURE_SIGNATURES = [
  /Minified React error #(418|421|422|423|425)\b/,
  /Hydration failed because/i,
  /There was an error while hydrating/i,
  /Text content does not match server-rendered HTML/i,
  /Unexpected Suspense handler tag/i,
];

/** A page in a hydration loop could report forever; three is enough to diagnose. */
const MAX_HYDRATION_REPORTS = 3;

if (typeof window !== 'undefined') {
  const original = console.error;
  let reported = 0;

  console.error = (...args: unknown[]) => {
    try {
      if (reported < MAX_HYDRATION_REPORTS) {
        const text = args
          .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : ''))
          .join(' ');
        if (REACT_FAILURE_SIGNATURES.some((re) => re.test(text))) {
          reported += 1;
          const err = args.find((a): a is Error => a instanceof Error) ?? new Error(text.slice(0, 300));
          Sentry.captureException(err, {
            tags: { boundary: 'hydration', errorSide: 'client', reactHydration: 'true' },
            extra: { pathname: window.location.pathname, message: text.slice(0, 1000) },
          });
        }
      }
    } catch {
      // Reporting must never be the reason a page breaks. Swallow and fall
      // through to the real console.error below.
    }
    original(...(args as []));
  };
}
