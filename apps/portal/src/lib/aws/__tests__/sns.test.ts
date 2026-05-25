import { describe, it, expect, beforeEach } from 'vitest';
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
