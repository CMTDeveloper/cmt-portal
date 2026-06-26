import * as Sentry from '@sentry/nextjs';

// Next.js `register()` runs once when the server starts, before any request is
// handled. We load the runtime-specific Sentry config here so the Node.js and
// Edge runtimes each initialise with the right integrations (profiling is
// Node-only). The client is initialised separately via instrumentation-client.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown in nested React Server Components (Next.js 15+).
export const onRequestError = Sentry.captureRequestError;
