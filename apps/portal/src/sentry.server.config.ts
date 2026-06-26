// Sentry init for the Node.js server runtime. Loaded from instrumentation.ts
// when NEXT_RUNTIME === 'nodejs'. This is the only runtime that supports the
// native v8 profiler (@sentry/profiling-node), so profiling lives here.
import * as Sentry from '@sentry/nextjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { SENTRY_DSN } from './sentry.dsn';

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

  // dataCollection: {
  //   // To disable sending user data and HTTP bodies, uncomment the lines below:
  //   // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
  //   userInfo: false,
  //   httpBodies: [],
  // },
});
