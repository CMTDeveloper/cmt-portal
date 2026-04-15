import 'server-only';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { snsRegion } from './region';

let cached: SNSClient | undefined;
function client(): SNSClient {
  if (cached) return cached;
  cached = new SNSClient({ region: snsRegion() });
  return cached;
}

export interface SendSMSArgs {
  phone: string;
  message: string;
}

export async function sendSMS(args: SendSMSArgs): Promise<void> {
  const phone = args.phone.startsWith('+') ? args.phone : `+${args.phone}`;
  await client().send(
    new PublishCommand({
      PhoneNumber: phone,
      Message: args.message,
    }),
  );
}
