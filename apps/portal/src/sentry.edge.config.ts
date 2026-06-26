// Sentry init for the Edge runtime (middleware + edge routes). Loaded from
// instrumentation.ts when NEXT_RUNTIME === 'edge'. The native profiler is
// Node-only, so there is no profiling here.
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN } from './sentry.dsn';

const isDev = process.env.NODE_ENV === 'development';

Sentry.init({
  dsn: SENTRY_DSN,

  // Send structured logs to Sentry.
  enableLogs: true,

  // Trace 100% of requests in dev, 10% in production.
  tracesSampleRate: isDev ? 1.0 : 0.1,
});
