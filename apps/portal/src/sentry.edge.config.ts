// Sentry init for the Edge runtime (middleware + edge routes). Loaded from
// instrumentation.ts when NEXT_RUNTIME === 'edge'. The native profiler is
// Node-only, so there is no profiling here.
import * as Sentry from '@sentry/nextjs';

const isDev = process.env.NODE_ENV === 'development';

Sentry.init({
  dsn: 'https://09a8c83d124c0972291055debfeeafb0@o4511632222846976.ingest.us.sentry.io/4511632231956480',

  // Send structured logs to Sentry.
  enableLogs: true,

  // Trace 100% of requests in dev, 10% in production.
  tracesSampleRate: isDev ? 1.0 : 0.1,
});
