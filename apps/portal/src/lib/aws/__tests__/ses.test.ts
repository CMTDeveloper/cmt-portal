import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  TemplateDoesNotExistException,
  ConfigurationSetDoesNotExistException,
} from '@aws-sdk/client-ses';
import { sendEmail, sendSesTemplatedEmail } from '../ses';

const sesMock = mockClient(SESClient);

beforeEach(() => {
  sesMock.reset();
  process.env.AWS_SES_FROM_EMAIL = 'noreply@chinmayatoronto.org';
  process.env.AWS_SES_REGION = 'ca-central-1';
});

describe('sendEmail', () => {
  it('calls SES SendEmailCommand with correct shape', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'msg-1' });
    await sendEmail({
      to: 'a@b.com',
      subject: 'Test',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input as {
      Source: string;
      Destination: { ToAddresses: string[] };
      Message: { Subject: { Data: string }; Body: { Html: { Data: string }; Text: { Data: string } } };
    };
    // WITH a display name since 2026-07-30 - a bare address is what mail
    // clients showed, and CMT asked for a name.
    expect(input.Source).toBe('"Bala Vihar Registration" <noreply@chinmayatoronto.org>');
    expect(input.Destination.ToAddresses).toEqual(['a@b.com']);
    expect(input.Message.Subject.Data).toBe('Test');
    expect(input.Message.Body.Html.Data).toBe('<p>Hello</p>');
    expect(input.Message.Body.Text.Data).toBe('Hello');
  });

  it('throws a descriptive error on SES failure', async () => {
    sesMock.on(SendEmailCommand).rejects(new Error('AccessDenied'));
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'T', text: 't' }),
    ).rejects.toThrow(/AccessDenied/);
  });
});

describe('sendSesTemplatedEmail', () => {
  it('calls SendTemplatedEmailCommand with the template name and JSON TemplateData', async () => {
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'msg-2' });

    await sendSesTemplatedEmail({
      to: 'a@b.com',
      templateName: 'cmt-setu-invite',
      data: { familyName: 'Patel', inviteUrl: 'https://x/y' },
    });

    const calls = sesMock.commandCalls(SendTemplatedEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input as {
      Source: string;
      Destination: { ToAddresses: string[] };
      Template: string;
      TemplateData: string;
    };
    // WITH a display name since 2026-07-30 - a bare address is what mail
    // clients showed, and CMT asked for a name.
    expect(input.Source).toBe('"Bala Vihar Registration" <noreply@chinmayatoronto.org>');
    expect(input.Destination.ToAddresses).toEqual(['a@b.com']);
    expect(input.Template).toBe('cmt-setu-invite');
    // TemplateData is a JSON STRING, not an object. Passing the object through
    // is accepted by the type as `any` at some call shapes but rejected by SES.
    expect(typeof input.TemplateData).toBe('string');
    expect(JSON.parse(input.TemplateData)).toEqual({
      familyName: 'Patel',
      inviteUrl: 'https://x/y',
    });
  });

  it('propagates TemplateDoesNotExistException unchanged', async () => {
    // This layer never decides to fall back - the caller does. Swallowing the
    // exception here would make the missing-template case indistinguishable
    // from a successful send.
    sesMock
      .on(SendTemplatedEmailCommand)
      .rejects(new TemplateDoesNotExistException({ message: 'no such template', $metadata: {} }));

    await expect(
      sendSesTemplatedEmail({ to: 'a@b.com', templateName: 'nope', data: {} }),
    ).rejects.toBeInstanceOf(TemplateDoesNotExistException);
  });

  it('requires the same sender identity sendEmail uses', async () => {
    delete process.env.AWS_SES_FROM_EMAIL;
    await expect(
      sendSesTemplatedEmail({ to: 'a@b.com', templateName: 't', data: {} }),
    ).rejects.toThrow(/AWS_SES_FROM_EMAIL/);
  });
});

describe('sendSesTemplatedEmail — SES_CONFIGURATION_SET', () => {
  // The configuration set is what makes render failures visible AT ALL. SES
  // accepts a message whose template fails to render, returns a MessageId, and
  // delivers nothing - so without a RENDERING_FAILURE event destination the
  // loss is silent to the application and to everyone else.
  afterEach(() => {
    delete process.env.SES_CONFIGURATION_SET;
  });

  it('omits ConfigurationSetName entirely when the var is unset', async () => {
    // Not `undefined` riding in on a spread: the key must be absent.
    delete process.env.SES_CONFIGURATION_SET;
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm' });

    await sendSesTemplatedEmail({ to: 'a@b.com', templateName: 't', data: {} });

    const input = sesMock.commandCalls(SendTemplatedEmailCommand)[0]!.args[0].input;
    expect('ConfigurationSetName' in input).toBe(false);
  });

  it('sets ConfigurationSetName when the var is present', async () => {
    process.env.SES_CONFIGURATION_SET = 'cmt-render-failures';
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm' });

    await sendSesTemplatedEmail({ to: 'a@b.com', templateName: 't', data: {} });

    const input = sesMock.commandCalls(SendTemplatedEmailCommand)[0]!.args[0].input as {
      ConfigurationSetName?: string;
    };
    expect(input.ConfigurationSetName).toBe('cmt-render-failures');
  });

  it('retries once WITHOUT the configuration set when SES says it does not exist', async () => {
    // Configuration sets are region-scoped exactly like templates. A misspelled
    // name, or one created in a region other than AWS_SES_REGION, would
    // otherwise make every managed email throw - a failure impossible before
    // this feature existed, and worst at the invite (a 500 with the row already
    // written) and the payment-reminder cron (which retries forever because
    // lastReminderSentAt is written after the send).
    process.env.SES_CONFIGURATION_SET = 'typo-set';
    sesMock
      .on(SendTemplatedEmailCommand)
      .rejectsOnce(
        new ConfigurationSetDoesNotExistException({ message: 'nope', $metadata: {} }),
      )
      .resolves({ MessageId: 'm' });

    await sendSesTemplatedEmail({ to: 'a@b.com', templateName: 't', data: {} });

    const calls = sesMock.commandCalls(SendTemplatedEmailCommand);
    expect(calls).toHaveLength(2);
    expect('ConfigurationSetName' in calls[0]!.args[0].input).toBe(true);
    expect('ConfigurationSetName' in calls[1]!.args[0].input).toBe(false);
  });

  it('does NOT retry a template-missing failure, so the caller still sees it', async () => {
    // The retry is scoped to the configuration set. Retrying anything else
    // would hide the one error sendManagedEmail falls back on.
    process.env.SES_CONFIGURATION_SET = 'cmt-render-failures';
    sesMock
      .on(SendTemplatedEmailCommand)
      .rejects(new TemplateDoesNotExistException({ message: 'nope', $metadata: {} }));

    await expect(
      sendSesTemplatedEmail({ to: 'a@b.com', templateName: 'missing', data: {} }),
    ).rejects.toBeInstanceOf(TemplateDoesNotExistException);
    expect(sesMock.commandCalls(SendTemplatedEmailCommand)).toHaveLength(1);
  });
});


// ── The From display name (Vaibhav, 2026-07-30: "the name, can you adjust?") ──
// A delivered email showed only `bvregistration@chinmayatoronto.org`. These pin
// the header composition, because the failure mode is invisible from inside the
// process: SES accepts a malformed or mojibake From and the only evidence is
// what a family sees in their inbox.
describe('the From display name', () => {
  afterEach(() => {
    delete process.env.AWS_SES_FROM_NAME;
  });

  it('defaults to "Bala Vihar Registration", quoted, with the address in angle brackets', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'm' });
    await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"Bala Vihar Registration" <noreply@chinmayatoronto.org>');
  });

  it('applies to TEMPLATED sends too - that is the path CMT\'s three emails use', async () => {
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm' });
    await sendSesTemplatedEmail({ to: 'a@b.com', templateName: 'bv_enrolled_donation_complete', data: {} });
    const input = sesMock.commandCalls(SendTemplatedEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"Bala Vihar Registration" <noreply@chinmayatoronto.org>');
  });

  it('AWS_SES_FROM_NAME overrides the default', async () => {
    process.env.AWS_SES_FROM_NAME = 'CMT Bala Vihar';
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'm' });
    await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"CMT Bala Vihar" <noreply@chinmayatoronto.org>');
  });

  it('an EMPTY name falls back to the bare address rather than emitting `"" <addr>`', async () => {
    process.env.AWS_SES_FROM_NAME = '   ';
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'm' });
    await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('noreply@chinmayatoronto.org');
  });

  // An unescaped quote would close the quoted-string early and corrupt the header.
  it('escapes a quote and a backslash in the name', async () => {
    process.env.AWS_SES_FROM_NAME = 'CMT "BV" \\ Toronto';
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'm' });
    await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"CMT \\"BV\\" \\\\ Toronto" <noreply@chinmayatoronto.org>');
  });

  // A raw 8-bit byte in a header is not legal and arrives as mojibake.
  it('RFC 2047 encodes a non-ASCII name instead of emitting raw bytes', async () => {
    process.env.AWS_SES_FROM_NAME = 'Chinmaya Mission Torontô';
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'm' });
    await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe(
      `=?UTF-8?B?${Buffer.from('Chinmaya Mission Torontô', 'utf8').toString('base64')}?= <noreply@chinmayatoronto.org>`,
    );
  });

  it('still refuses to send with no AWS_SES_FROM_EMAIL at all', async () => {
    delete process.env.AWS_SES_FROM_EMAIL;
    await expect(sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toThrow(
      /AWS_SES_FROM_EMAIL is required/,
    );
  });
});

/**
 * The per-email `From` (CMT's `setu_otp` sends as "Chinmaya Setu"
 * <noreply@chinmayatoronto.org>, not as Bala Vihar Registration).
 *
 * These live HERE, at the wire, on purpose. A Codex review (2026-07-31) noted
 * that the send-managed-email test only proves a `from` object reaches a MOCKED
 * resolveSender - it would still pass if ses.ts ignored `args.from` entirely.
 * The Source header is the only thing a family actually sees.
 */
describe('a per-email From identity', () => {
  afterEach(() => {
    delete process.env.AWS_SES_FROM_NAME;
  });

  it('overrides BOTH the address and the name on a templated send', async () => {
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm' });
    await sendSesTemplatedEmail({
      to: 'a@b.com',
      templateName: 'setu_otp',
      data: { otp_pin: '123456' },
      from: { email: 'noreply@chinmayatoronto.org', name: 'Chinmaya Setu' },
    });
    const input = sesMock.commandCalls(SendTemplatedEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"Chinmaya Setu" <noreply@chinmayatoronto.org>');
  });

  // 🔴 A global "everything is Bala Vihar Registration" setting must not relabel
  // a sender the owner named explicitly.
  it('BEATS AWS_SES_FROM_NAME rather than being overridden by it', async () => {
    process.env.AWS_SES_FROM_NAME = 'Bala Vihar Registration';
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm' });
    await sendSesTemplatedEmail({
      to: 'a@b.com',
      templateName: 'setu_otp',
      data: {},
      from: { email: 'noreply@chinmayatoronto.org', name: 'Chinmaya Setu' },
    });
    const input = sesMock.commandCalls(SendTemplatedEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"Chinmaya Setu" <noreply@chinmayatoronto.org>');
  });

  // An operator clearing AWS_SES_OTP_FROM_EMAIL yields '' - that must fall back
  // to the portal address, NOT throw and take sign-in down.
  it('treats a blank override address as absent instead of throwing', async () => {
    process.env.AWS_SES_FROM_EMAIL = 'bvregistration@chinmayatoronto.org';
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'm' });
    await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T', from: { email: '   ', name: 'Chinmaya Setu' } });
    const input = sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"Chinmaya Setu" <bvregistration@chinmayatoronto.org>');
  });

  it('leaves every other email on the portal default', async () => {
    sesMock.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm' });
    await sendSesTemplatedEmail({ to: 'a@b.com', templateName: 'bv_enrolled_donation_pending', data: {} });
    const input = sesMock.commandCalls(SendTemplatedEmailCommand)[0]!.args[0].input as { Source: string };
    expect(input.Source).toBe('"Bala Vihar Registration" <noreply@chinmayatoronto.org>');
  });
});
