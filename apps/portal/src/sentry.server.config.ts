// Sentry init for the Node.js server runtime. Loaded from instrumentation.ts
// when NEXT_RUNTIME === 'nodejs'. This is the only runtime that supports the
// native v8 profiler (@sentry/profiling-node), so profiling lives here.
import * as Sentry from '@sentry/nextjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { SENTRY_DSN } from './sentry.dsn';
import { SENTRY_DATA_COLLECTION, scrubSentryEvent } from './lib/sentry/scrub-event';

const isDev = process.env.NODE_ENV === 'development';

Sentry.init({
  dsn: SENTRY_DSN,

  integrations: [nodeProfilingIntegration()],

  // Send structured logs to Sentry.
  enableLogs: true,

  // Trace 100% of requests in dev, 10% in production to keep quota/overhead sane.
  tracesSampleRate: isDev ? 1.0 : 0.1,

  // Continuous profiling: the profiler runs while any span is active. The
  // session sample rate is evaluated once per SDK.init call.
  profileSessionSampleRate: isDev ? 1.0 : 0.1,
  profileLifecycle: 'trace',

  // Privacy controls. See lib/sentry/scrub-event.ts — every dataCollection
  // field is pinned there on purpose, because a PARTIAL object widens the
  // fields it omits rather than leaving them alone.
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,

  // NOTE: `includeLocalVariables` is deliberately not set. It is the switch that
  // actually activates localVariablesIntegration (a no-op without it), and
  // turning it on would serialize function locals — including anything holding
  // bank details or credentials — into every stack frame.
});
