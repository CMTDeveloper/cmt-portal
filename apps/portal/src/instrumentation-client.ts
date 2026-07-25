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
