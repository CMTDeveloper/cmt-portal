// Shared Sentry privacy configuration. Imported by all three init sites
// (server, edge, client), so it must stay isomorphic: no node builtins, no DOM,
// no Next imports.
//
// Two independent controls live here:
//
//  1. SENTRY_DATA_COLLECTION - what the SDK is allowed to attach in the first
//     place. This is the real control.
//  2. scrubSentryEvent - a beforeSend pass that redacts sensitive keys anywhere
//     in the event graph. Defense in depth for values that reach an event by
//     some path the SDK options don't cover (manual setExtra, a serialized
//     error, a console breadcrumb carrying an object).
//
// Neither replaces the primary rule: never put bank details, credentials or
// OTPs into a log line, an error message, or Sentry context to begin with.

export const REDACTED = '[Redacted]';

/**
 * Key snippets that mark a value as sensitive. Matched as substrings against
 * the key lowercased with separators stripped, so `Transit_Number`,
 * `transit-number` and `transitNumber` all match `transit`.
 *
 * Deliberately NOT here: email, phone, name, address, fid. Those identify which
 * family hit an error and are the primary key of the domain model - redacting
 * them would make Sentry useless for support without meaningfully reducing
 * exposure, since the same values appear in URLs and error messages.
 */
export const SENTRY_DENY_KEY_SNIPPETS = [
  // Credentials and secrets
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'privatekey',
  'credential',
  // Banking (monthly pledge / pre-authorized debit)
  'bank',
  'transit',
  'institution',
  'accountnumber',
  'iban',
  'routingnumber',
  'cardnumber',
];

/**
 * Short keys too ambiguous for substring matching - `sin` would match "using",
 * `pin` would match "shipping".
 */
const DENY_KEYS_EXACT = new Set(['sin', 'otp', 'cvv', 'cvc', 'pin']);

/** Depth cap so a pathological object graph can't stall the event pipeline. */
const MAX_DEPTH = 8;

/**
 * What the SDK may collect. Every field is pinned on purpose.
 *
 * The SDK resolves this in `resolveDataCollectionOptions`: when `dataCollection`
 * is absent it falls back to the restrictive no-`sendDefaultPii` baseline, but
 * the moment the object is present ANY omitted field resolves against the
 * PERMISSIVE defaults instead (`cookies: true`, `httpHeaders: {request: true,
 * response: true}`, `queryParams: true`). So a partial object - for instance the
 * `{ userInfo: false, httpBodies: [] }` snippet the SDK ships commented out -
 * silently widens cookie, header and query-param collection. Set every field.
 */
export const SENTRY_DATA_COLLECTION = {
  /** Never auto-populate `user.*` from instrumentation. */
  userInfo: false,
  /** The Firebase session cookie is a bearer credential. Collect no cookies. */
  cookies: false,
  httpHeaders: {
    request: { deny: SENTRY_DENY_KEY_SNIPPETS },
    response: { deny: SENTRY_DENY_KEY_SNIPPETS },
  },
  /** No request or response bodies, in either direction. */
  httpBodies: [],
  queryParams: { deny: SENTRY_DENY_KEY_SNIPPETS },
  /** No generative-AI IO in this app, but pin it so a future integration can't opt us in. */
  genAI: { inputs: false, outputs: false },
  /**
   * Local variables in stack frames. Today `localVariablesIntegration` is a
   * no-op unless `includeLocalVariables: true` is also set (we never set it),
   * but pin this so we stay closed when the SDK wires the option up.
   */
  stackFrameVariables: false,
  /** Source context around each frame - our own code, not user data. SDK default. */
  frameContextLines: 7,
};

function isSensitiveKey(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (DENY_KEYS_EXACT.has(normalized)) return true;
  if (SENTRY_DENY_KEY_SNIPPETS.some((snippet) => normalized.includes(snippet))) {
    return true;
  }
  // `code` is both the OTP field on /api/setu/auth/verify-code and the field
  // Firebase Admin errors use (`auth/id-token-expired`). Only the OTP shape is
  // sensitive, and losing the Firebase code would cost real debuggability.
  if (normalized === 'code') return typeof value === 'string' && /^\d{6}$/.test(value);

  return false;
}

function redactInPlace(node: object, depth: number, seen: WeakSet<object>): void {
  if (depth > MAX_DEPTH || seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === 'object') redactInPlace(item, depth + 1, seen);
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (isSensitiveKey(key, value)) {
      (node as Record<string, unknown>)[key] = REDACTED;
    } else if (value && typeof value === 'object') {
      redactInPlace(value, depth + 1, seen);
    }
  }
}

/**
 * Redacts sensitive keys anywhere in a Sentry event, in place. Wired as
 * `beforeSend` / `beforeSendTransaction` on every init site.
 *
 * Key-based only: there is no value-shape heuristic for bank numbers because a
 * Canadian transit (5 digits), institution (3) and account (7-12) are
 * indistinguishable from the FIDs, member ids and timestamps this app is full
 * of, so a numeric regex would redact most of what makes an event useful.
 */
export function scrubSentryEvent<T>(event: T): T {
  if (event && typeof event === 'object') {
    redactInPlace(event, 0, new WeakSet());
  }
  return event;
}
