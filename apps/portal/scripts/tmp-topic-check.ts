// TEMP read-only: what is actually subscribed to these topics, and is there an
// SMS-capable originator anywhere? A topic fans messages OUT to subscribers; it
// is never the number a text is sent FROM.
import { SNSClient, ListTopicsCommand, ListSubscriptionsByTopicCommand, ListOriginationNumbersCommand } from '@aws-sdk/client-sns';

const creds = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
};

async function region(r: string) {
  const c = new SNSClient({ region: r, credentials: creds });
  console.log(`\n=== ${r} ===`);
  const topics = await c.send(new ListTopicsCommand({}));
  for (const t of topics.Topics ?? []) {
    const arn = t.TopicArn!;
    const subs = await c.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn }));
    const list = (subs.Subscriptions ?? []).map((s) => `${s.Protocol}:${s.Endpoint}`);
    console.log(`  topic ${arn.split(':').pop()}`);
    console.log(`    subscriptions: ${list.length ? list.join(', ') : 'NONE'}`);
    console.log(`    sms subscribers: ${(subs.Subscriptions ?? []).filter((s) => s.Protocol === 'sms').length}`);
  }
  const orig = await c.send(new ListOriginationNumbersCommand({}));
  console.log(`  ORIGINATION NUMBERS: ${(orig.PhoneNumbers ?? []).length === 0 ? 'NONE' : (orig.PhoneNumbers ?? []).map((p) => p.PhoneNumber).join(', ')}`);
}

async function main() {
  for (const r of ['ca-central-1', 'us-east-1']) await region(r);
}
main().catch((e) => { console.error(e); process.exit(1); });
