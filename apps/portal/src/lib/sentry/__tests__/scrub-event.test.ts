import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  SENTRY_DATA_COLLECTION,
  SENTRY_DENY_KEY_SNIPPETS,
  scrubSentryEvent,
} from '../scrub-event';

describe('SENTRY_DATA_COLLECTION', () => {
  // Providing a `dataCollection` object at all makes the SDK resolve every
  // omitted field against its PERMISSIVE defaults (cookies/headers/queryParams
  // all `true`) instead of the restrictive no-sendDefaultPii baseline. So every
  // field must be pinned here — omission is not "leave it alone", it is "opt in".
  it('pins every field the SDK resolves', () => {
    expect(Object.keys(SENTRY_DATA_COLLECTION).sort()).toEqual([
      'cookies',
      'frameContextLines',
      'genAI',
      'httpBodies',
      'httpHeaders',
      'queryParams',
      'stackFrameVariables',
      'userInfo',
    ]);
  });

  it('collects no request bodies, cookies, user info or stack-frame locals', () => {
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([]);
    expect(SENTRY_DATA_COLLECTION.cookies).toBe(false);
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false);
    expect(SENTRY_DATA_COLLECTION.stackFrameVariables).toBe(false);
  });

  it('deny-lists our sensitive keys on headers and query params', () => {
    expect(SENTRY_DATA_COLLECTION.queryParams).toEqual({
      deny: SENTRY_DENY_KEY_SNIPPETS,
    });
    expect(SENTRY_DATA_COLLECTION.httpHeaders.request).toEqual({
      deny: SENTRY_DENY_KEY_SNIPPETS,
    });
    expect(SENTRY_DATA_COLLECTION.httpHeaders.response).toEqual({
      deny: SENTRY_DENY_KEY_SNIPPETS,
    });
  });

  it('keeps source context lines at the SDK default of 7', () => {
    // Source context is our own code, not user data. Lowering it would be a
    // gratuitous debugging regression.
    expect(SENTRY_DATA_COLLECTION.frameContextLines).toBe(7);
  });
});

describe('scrubSentryEvent', () => {
  it('redacts bank details nested in extra', () => {
    const event = {
      extra: {
        pledge: {
          transitNumber: '12345',
          institutionNumber: '003',
          accountNumber: '1234567',
          amountCents: 5000,
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.extra.pledge).toEqual({
      transitNumber: REDACTED,
      institutionNumber: REDACTED,
      accountNumber: REDACTED,
      amountCents: 5000,
    });
  });

  it('redacts stack-frame local variables', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  function: 'savePledge',
                  vars: { bankAccount: '1234567', fid: 'CMT-ABC' },
                },
              ],
            },
          },
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.exception.values[0]!.stacktrace.frames[0]!.vars).toEqual({
      bankAccount: REDACTED,
      fid: 'CMT-ABC',
    });
    // Structural fields must survive untouched.
    expect(scrubbed.exception.values[0]!.type).toBe('TypeError');
    expect(scrubbed.exception.values[0]!.value).toBe('boom');
  });

  it('redacts breadcrumb data and request bodies', () => {
    const event = {
      breadcrumbs: [
        { category: 'http', data: { authorization: 'Bearer abc', url: '/api' } },
      ],
      request: {
        url: 'https://cmt-setu.vercel.app/api/pledges',
        data: { accountNumber: '999', pledgeAmount: 50 },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.breadcrumbs[0]!.data).toEqual({
      authorization: REDACTED,
      url: '/api',
    });
    expect(scrubbed.request.data).toEqual({
      accountNumber: REDACTED,
      pledgeAmount: 50,
    });
    expect(scrubbed.request.url).toBe('https://cmt-setu.vercel.app/api/pledges');
  });

  it('matches keys regardless of case, underscores or dashes', () => {
    const event = {
      extra: {
        Transit_Number: '12345',
        'institution-number': '003',
        APIKEY: 'k',
      },
    };

    expect(scrubSentryEvent(event).extra).toEqual({
      Transit_Number: REDACTED,
      'institution-number': REDACTED,
      APIKEY: REDACTED,
    });
  });

  it('redacts a 6-digit `code` (an OTP) but keeps a Firebase error code', () => {
    // `code` is the OTP field on /api/setu/auth/verify-code AND the field name
    // Firebase Admin uses for `auth/id-token-expired`. Only the OTP shape goes.
    const event = {
      extra: { otpAttempt: { code: '123456' }, authError: { code: 'auth/user-not-found' } },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.extra.otpAttempt.code).toBe(REDACTED);
    expect(scrubbed.extra.authError.code).toBe('auth/user-not-found');
  });

  it('leaves contact details alone', () => {
    // Deliberate: email/phone are how support identifies which family hit an
    // error, and they are already the primary key of the whole domain model.
    const event = { extra: { email: 'a@b.com', phone: '+14165550000', fid: 'CMT-X' } };

    expect(scrubSentryEvent(event).extra).toEqual({
      email: 'a@b.com',
      phone: '+14165550000',
      fid: 'CMT-X',
    });
  });

  it('walks arrays of objects', () => {
    const event = { extra: { members: [{ name: 'A', sin: '123456789' }] } };

    expect(scrubSentryEvent(event).extra.members[0]).toEqual({
      name: 'A',
      sin: REDACTED,
    });
  });

  it('survives circular references', () => {
    const inner: Record<string, unknown> = { password: 'hunter2' };
    inner.self = inner;
    const event = { extra: { inner } };

    const scrubbed = scrubSentryEvent(event);

    expect((scrubbed.extra.inner as Record<string, unknown>).password).toBe(REDACTED);
  });

  it('returns non-object events untouched', () => {
    expect(scrubSentryEvent(null)).toBeNull();
    expect(scrubSentryEvent(undefined)).toBeUndefined();
  });
});
