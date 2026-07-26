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
    expect(input.Source).toBe('noreply@chinmayatoronto.org');
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
    expect(input.Source).toBe('noreply@chinmayatoronto.org');
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
