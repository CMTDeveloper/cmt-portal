// TEMP A/B: does ca-central-1 (SANDBOX, number verified) deliver where
// us-east-1 (PRODUCTION, no origination number) did not?
// Replicates the legacy check-in app's call EXACTLY: no MessageAttributes,
// OTP-shaped text - so message content is held constant across both sends.
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const PHONE = '+14379712609'; // the owner's own number, he authorised this

async function send(region: string, label: string, code: string) {
  const c = new SNSClient({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  try {
    // Byte-for-byte the legacy app's params: Message + PhoneNumber, nothing else.
    const r = await c.send(new PublishCommand({
      Message: `Your verification code is: ${code}`,
      PhoneNumber: PHONE,
    }));
    console.log(`${label.padEnd(28)} region=${region.padEnd(13)} code=${code}  MessageId=${r.MessageId}`);
  } catch (e) {
    console.log(`${label.padEnd(28)} region=${region.padEnd(13)} FAILED ${(e as Error).name}: ${(e as Error).message}`);
  }
}

async function main() {
  // Distinct codes so the owner can tell the two apart on the handset.
  await send('ca-central-1', 'A) sandbox+verified', '111111');
  await send('us-east-1', 'B) production, no orig', '222222');
}
main().catch((e) => { console.error(e); process.exit(1); });
