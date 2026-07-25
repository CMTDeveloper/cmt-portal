// Sentry init for the Edge runtime (middleware + edge routes). Loaded from
// instrumentation.ts when NEXT_RUNTIME === 'edge'. The native profiler is
// Node-only, so there is no profiling here.
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

  // Privacy controls — shared with the server and client inits. Middleware runs
  // here, so this is the runtime that sees the session cookie on every request.
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});
