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

  // SNS cannot deliver outside NANP from this account: no Origination Number is
  // registered for any other region, so a publish is accepted, billed, and
  // dropped. Refusing here covers ALL seven callers at once - including the
  // prasad reminders and the join-request manager notification, which publish
  // to international numbers on every run today and would otherwise keep doing
  // so even after SMS sign-in is restored. Deliberately independent of
  // flags.smsOtp: this is about what the account can physically deliver.
  // Log the prefix only - the full number is PII and this line goes to Vercel.
  if (!phone.startsWith('+1')) {
    console.error(
      `[sns] refusing non-+1 publish to ${phone.slice(0, 4)}... - SNS cannot deliver to this country from this account`,
    );
    return;
  }

  // SMSType=Transactional is critical for OTP delivery. SNS defaults to
  // Promotional, which carriers heavily filter and rate-limit; transactional
  // gets the high-priority delivery path. (Confirmed root cause when the
  // portal's first prod OTP SMS to +14379712609 was accepted by SNS but
  // never reached the carrier.)
  console.log(`[sns] publish region=${snsRegion()} phone=${phone}`);
  const result = await client().send(
    new PublishCommand({
      PhoneNumber: phone,
      Message: args.message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
      },
    }),
  );
  console.log(`[sns] published MessageId=${result.MessageId ?? '?'}`);
}
