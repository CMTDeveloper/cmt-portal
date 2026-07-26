import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  TemplateDoesNotExistException,
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
