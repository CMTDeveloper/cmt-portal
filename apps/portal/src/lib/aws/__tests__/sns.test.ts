import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { sendSMS } from '../sns';

const snsMock = mockClient(SNSClient);

beforeEach(() => {
  snsMock.reset();
  process.env.AWS_SNS_REGION = 'us-east-1';
});

describe('sendSMS', () => {
  it('calls SNS PublishCommand with PhoneNumber and Message', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-1' });
    await sendSMS({ phone: '+16475550100', message: 'Hari OM' });
    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input as { PhoneNumber: string; Message: string };
    expect(input.PhoneNumber).toBe('+16475550100');
    expect(input.Message).toBe('Hari OM');
  });

  it('prepends + if missing', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-2' });
    await sendSMS({ phone: '16475550100', message: 'x' });
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input as { PhoneNumber: string };
    expect(input.PhoneNumber).toBe('+16475550100');
  });

  it('tags the message as Transactional for OTP delivery priority', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-3' });
    await sendSMS({ phone: '+16475550100', message: 'x' });
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input as {
      MessageAttributes?: Record<string, { DataType: string; StringValue: string }>;
    };
    expect(input.MessageAttributes?.['AWS.SNS.SMS.SMSType']).toEqual({
      DataType: 'String',
      StringValue: 'Transactional',
    });
  });
});

describe('sendSMS — non-NANP refusal', () => {
  // This account has no Origination Number outside NANP, so SNS accepts a
  // non-+1 publish, bills for it, and delivers nothing. The guard sits at the
  // publish layer rather than at each caller because four of the seven callers
  // are not otherwise touched - the two prasad senders and the join-request
  // manager notification publish to international numbers on every run.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a non-+1 number without publishing', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-x' });
    await sendSMS({ phone: '+919876543210', message: 'x' });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it('logs only the prefix, never the whole number', async () => {
    // The log goes to Vercel, and a full phone number is PII.
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-x' });
    await sendSMS({ phone: '+919876543210', message: 'x' });
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).not.toContain('9876543210');
    expect(logged).toContain('+919');
  });

  it('still publishes to +1 numbers', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-y' });
    await sendSMS({ phone: '+14165550100', message: 'x' });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
  });

  it('applies AFTER the + is prepended, so a bare 10-digit NANP number still sends', async () => {
    // sendSMS normalizes '16475550100' to '+16475550100'. Checking the raw
    // argument instead would refuse every unprefixed Canadian number.
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-z' });
    await sendSMS({ phone: '16475550100', message: 'x' });
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
  });
});
