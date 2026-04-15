import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { sendEmail } from '../ses';

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
