// Single source of truth for the Sentry DSN, imported by the server, edge, and
// client init files so the value can never drift across the three. This is the
// public project key (safe to commit) for the `javascript-nextjs` project in
// the `chinmaya-mission-toronto` org.
export const SENTRY_DSN =
  'https://770f42a48217febabf53854c9b0a438a@o4511632222846976.ingest.us.sentry.io/4511632391208960';
