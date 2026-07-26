import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TemplateDoesNotExistException } from '@aws-sdk/client-ses';

/**
 * The fallback matrix. Only TWO conditions may reach the in-code renderer:
 * a template that was never configured, and one SES reports as missing.
 * Everything else propagates, because falling back on a delivery failure both
 * masks the real problem and risks a double send.
 */

const mockSendSesTemplatedEmail = vi.hoisted(() => vi.fn());
vi.mock('../resolve-sender', () => ({
  resolveSender: () => ({
    sendEmail: vi.fn(),
    sendSMS: vi.fn(),
    sendSesTemplatedEmail: mockSendSesTemplatedEmail,
  }),
}));
// Mocked so the "never the raw module" assertion has something to observe.
vi.mock('../ses', () => ({ sendEmail: vi.fn(), sendSesTemplatedEmail: vi.fn() }));

import { sendManagedEmail } from '../send-managed-email';
import { sendSesTemplatedEmail as rawSendSesTemplatedEmail } from '../ses';

const TEMPLATE_VARS = [
  'SES_TEMPLATE_PAYMENT_REMINDER',
  'SES_TEMPLATE_DONATION_THANK_YOU',
  'SES_TEMPLATE_SETU_INVITE',
  'SES_TEMPLATE_SETU_JOIN_REQUEST',
  'SES_TEMPLATE_PLEDGE_ACTIVATED',
];

beforeEach(() => {
  vi.clearAllMocks();
  // Structural, not incidental: without this the suite's meaning depends on
  // whether .env.local happened to be loaded.
  for (const v of TEMPLATE_VARS) delete process.env[v];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const v of TEMPLATE_VARS) delete process.env[v];
  vi.restoreAllMocks();
});

function templateMissing() {
  return new TemplateDoesNotExistException({ message: 'no such template', $metadata: {} });
}

describe('sendManagedEmail', () => {
  it('uses the code fallback when no SES template name is configured', async () => {
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(mockSendSesTemplatedEmail).not.toHaveBeenCalled();
    // Info, not error: "not configured yet" is a design state during the
    // migration, not a misconfiguration.
    expect(console.info).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('sends through resolveSender, never the raw ses module', async () => {
    // send-managed-email.ts sits in the same directory as ses.ts, so
    // `import { sendSesTemplatedEmail } from './ses'` is the NATURAL import and
    // the wrong one: it bypasses SETU_EMAIL_ALLOWLIST, SETU_EMAIL_REDIRECT_TO
    // and the mock-sender route, and would mail real families from a test run.
    process.env.SES_TEMPLATE_SETU_INVITE = 'cmt-setu-invite';
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: { x: 1 }, fallback });

    expect(mockSendSesTemplatedEmail).toHaveBeenCalledTimes(1);
    expect(mockSendSesTemplatedEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      templateName: 'cmt-setu-invite',
      data: { x: 1 },
    });
    expect(rawSendSesTemplatedEmail).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the code fallback when SES says the template does not exist', async () => {
    process.env.SES_TEMPLATE_SETU_INVITE = 'cmt-setu-invite';
    mockSendSesTemplatedEmail.mockRejectedValueOnce(templateMissing());
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback });

    expect(fallback).toHaveBeenCalledTimes(1);
    // ERROR, not info: the env var names a template that is not there, which is
    // a misconfiguration. This log IS the migration checklist.
    expect(console.error).toHaveBeenCalled();
  });

  it('does NOT fall back on any other SES failure', async () => {
    // Throttling, auth, network. Falling back here would mask a real delivery
    // failure and could double-send a message SES already accepted.
    process.env.SES_TEMPLATE_SETU_INVITE = 'cmt-setu-invite';
    mockSendSesTemplatedEmail.mockRejectedValueOnce(new Error('Throttling'));
    const fallback = vi.fn(async () => {});

    await expect(
      sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback }),
    ).rejects.toThrow(/Throttling/);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('propagates a fallback failure unchanged, without re-wrapping it', async () => {
    // The invite sends after its transaction commits and does not catch, so a
    // throw is a 500 with the invite row already written. The caller must see
    // the real cause, not a wrapper naming the template.
    process.env.SES_TEMPLATE_SETU_INVITE = 'cmt-setu-invite';
    mockSendSesTemplatedEmail.mockRejectedValueOnce(templateMissing());
    const boom = new Error('SES AccessDenied from the in-code renderer');

    await expect(
      sendManagedEmail({
        name: 'setu-invite',
        to: 'a@b.com',
        data: {},
        fallback: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
  });

  it('never sends twice', async () => {
    process.env.SES_TEMPLATE_SETU_INVITE = 'cmt-setu-invite';
    mockSendSesTemplatedEmail.mockRejectedValueOnce(templateMissing());
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback });

    // The two conditions that reach the fallback are "never attempted" and
    // "SES rejected it for a missing template". SES does not queue a message it
    // rejected, so neither can double-deliver.
    expect(mockSendSesTemplatedEmail).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('treats an empty SES_TEMPLATE_* as unconfigured', async () => {
    // A var set to '' in Vercel is the shape an operator produces when clearing
    // one; treating it as a template name would send to a template called "".
    process.env.SES_TEMPLATE_SETU_INVITE = '   ';
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(mockSendSesTemplatedEmail).not.toHaveBeenCalled();
  });
});

describe('sendManagedEmail — the OTP exemption', () => {
  it('refuses an OTP-shaped name at runtime even if the type is bypassed', async () => {
    // Defence against a cast or `as never`. The compile-time assertion in
    // send-managed-email.ts is the primary guard; this catches the case where
    // someone routes around it. OTP must never leave the portal's own renderer:
    // it is the one email whose delivery latency and content the portal fully
    // controls, and an SES template edit could break every sign-in at once.
    const fallback = vi.fn(async () => {});

    await expect(
      sendManagedEmail({
        name: 'otp-code' as never,
        to: 'a@b.com',
        data: {},
        fallback,
      }),
    ).rejects.toThrow(/otp/i);
    expect(mockSendSesTemplatedEmail).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });
});
