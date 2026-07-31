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
import { SES_TEMPLATE_ENV_VARS } from '../email-templates-config';
import { sendSesTemplatedEmail as rawSendSesTemplatedEmail } from '../ses';

// The REGISTRY's list, not a hand-copy. The hand-copy this replaces had already
// drifted: it named five vars while eight existed, so the three bv_enrolled_*
// values in .env.local leaked into every run and the suite's meaning depended on
// which machine it ran on - the exact failure its own comment warns about. A
// derived list cannot drift when the ninth template is added.
// AWS_SES_OTP_FROM_EMAIL is NOT a SES_TEMPLATE_* var, so the registry does not
// carry it - but senderIdentityFor() reads it, so leaving it set would let
// .env.local decide what the sender-identity assertions below see.
const TEMPLATE_VARS = [...SES_TEMPLATE_ENV_VARS, 'AWS_SES_OTP_FROM_EMAIL'];

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

/**
 * OTP moved ONTO the managed path on 2026-07-31, when CMT authored `setu_otp`
 * and asked for it live. This suite used to assert the opposite - that the
 * module refused any OTP-shaped name outright.
 *
 * The reason for that refusal has NOT gone away: a bad SES template would break
 * every sign-in at once, and a family who cannot receive a code has no other way
 * in. It is now answered by delivery-first fallback rather than by prohibition,
 * so these tests pin the property the old refusal was protecting - the family
 * always gets a code - instead of the mechanism that used to protect it.
 */
describe('sendManagedEmail — OTP is delivery-first', () => {
  beforeEach(() => {
    process.env.SES_TEMPLATE_SETU_OTP = 'setu_otp';
  });

  it('uses CMT’s template, with their sender identity', async () => {
    const fallback = vi.fn(async () => {});
    await sendManagedEmail({
      name: 'otp-code',
      to: 'a@b.com',
      data: { otp_link: 'https://x/y', otp_pin: '123456' },
      fallback,
    });

    expect(mockSendSesTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'setu_otp',
        data: { otp_link: 'https://x/y', otp_pin: '123456' },
        // A sign-in code is not a Bala Vihar registration matter.
        from: { email: 'noreply@chinmayatoronto.org', name: 'Chinmaya Setu' },
      }),
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  // 🔴 The property the old prohibition existed to guarantee. Each of these
  // would, for any OTHER email, propagate and abort the send.
  it.each([
    ['a throttle', new Error('Throttling: Maximum sending rate exceeded')],
    ['an auth failure', new Error('SignatureDoesNotMatch')],
    ['a dead network', new Error('ECONNRESET')],
  ])('still delivers the code through the in-code renderer on %s', async (_label, err) => {
    mockSendSesTemplatedEmail.mockRejectedValue(err);
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'otp-code', to: 'a@b.com', data: {}, fallback });

    expect(fallback, 'a family who gets no code cannot sign in at all').toHaveBeenCalledTimes(1);
  });

  it('does NOT extend that leniency to any other email', async () => {
    // A donation notice that fails on a throttle must surface, not silently
    // re-render in code and risk double-delivering what SES already accepted.
    process.env.SES_TEMPLATE_SETU_INVITE = 'setu_invite';
    mockSendSesTemplatedEmail.mockRejectedValue(new Error('Throttling'));
    const fallback = vi.fn(async () => {});

    await expect(
      sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback }),
    ).rejects.toThrow(/throttling/i);
    expect(fallback).not.toHaveBeenCalled();
  });

  // 🔴 A catch cannot run for a promise that never settles, and the SES client
  // sets no timeout at all (Smithy's default is zero). Without a deadline the
  // sign-in request hangs on "Sending…" while the code it already stored
  // expires. Found by a Codex review, 2026-07-31.
  it('gives up on a send that never settles, and still delivers a code', async () => {
    vi.useFakeTimers();
    try {
      // Never resolves, never rejects - a stalled socket, not an error.
      mockSendSesTemplatedEmail.mockReturnValue(new Promise<void>(() => {}));
      const fallback = vi.fn(async () => {});

      const pending = sendManagedEmail({ name: 'otp-code', to: 'a@b.com', data: {}, fallback });
      await vi.advanceTimersByTimeAsync(4000);
      await pending;

      expect(fallback, 'a hang must not cost the family their sign-in').toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders in code when the template is not configured at all', async () => {
    // The steady state until SES_TEMPLATE_SETU_OTP is set: sign-in is untouched.
    delete process.env.SES_TEMPLATE_SETU_OTP;
    const fallback = vi.fn(async () => {});

    await sendManagedEmail({ name: 'otp-code', to: 'a@b.com', data: {}, fallback });

    expect(mockSendSesTemplatedEmail).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
