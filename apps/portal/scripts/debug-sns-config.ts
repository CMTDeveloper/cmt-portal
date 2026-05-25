/**
 * One-shot: query AWS SNS state — sandbox status, origination numbers,
 * spending limits, message attributes — using the same credentials the
 * portal uses at runtime. Helps diagnose "SNS publish OK but no SMS".
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local \
 *     scripts/debug-sns-config.ts [--phone "+14379712609"]
 */

import {
  SNSClient,
  GetSMSAttributesCommand,
  GetSMSSandboxAccountStatusCommand,
  ListOriginationNumbersCommand,
  ListPhoneNumbersOptedOutCommand,
  ListSMSSandboxPhoneNumbersCommand,
  PublishCommand,
} from '@aws-sdk/client-sns';

async function main() {
  const argv = process.argv.slice(2);
  const phoneIdx = argv.indexOf('--phone');
  const testPhone = phoneIdx >= 0 ? argv[phoneIdx + 1] : null;

  const region = process.env.AWS_SNS_REGION ?? 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  if (!accessKeyId) {
    console.error('AWS_ACCESS_KEY_ID missing — env not loaded?');
    process.exit(1);
  }
  console.log(`Region          : ${region}`);
  console.log(`Access key      : ${accessKeyId.slice(0, 4)}...${accessKeyId.slice(-4)}`);

  const client = new SNSClient({ region });

  // 1. Sandbox status
  try {
    const sb = await client.send(new GetSMSSandboxAccountStatusCommand({}));
    console.log(`\nSandbox status  : ${sb.IsInSandbox ? '⚠️  IN SANDBOX' : '✓ Production'}`);
  } catch (e) {
    console.log(`Sandbox status  : (query failed) ${(e as Error).message}`);
  }

  // 2. Sandbox verified destinations (only if in sandbox)
  try {
    const list = await client.send(new ListSMSSandboxPhoneNumbersCommand({}));
    if (list.PhoneNumbers && list.PhoneNumbers.length > 0) {
      console.log(`Sandbox verified: ${list.PhoneNumbers.map((p) => p.PhoneNumber + ' (' + p.Status + ')').join(', ')}`);
    }
  } catch (e) {
    /* ignore — only relevant in sandbox */
  }

  // 3. Account SMS attributes (spending limit, default sms type, etc.)
  try {
    const attrs = await client.send(new GetSMSAttributesCommand({}));
    console.log(`\nAccount SMS attributes:`);
    for (const [k, v] of Object.entries(attrs.attributes ?? {})) {
      console.log(`  ${k} = ${v}`);
    }
  } catch (e) {
    console.log(`Account attrs   : (query failed) ${(e as Error).message}`);
  }

  // 4. Origination numbers
  try {
    const list = await client.send(new ListOriginationNumbersCommand({}));
    if (list.PhoneNumbers && list.PhoneNumbers.length > 0) {
      console.log(`\nOrigination numbers (${list.PhoneNumbers.length}):`);
      for (const p of list.PhoneNumbers) {
        console.log(`  ${p.PhoneNumber} type=${p.PhoneNumberType} status=${p.Status} country=${p.Iso2CountryCode}`);
      }
    } else {
      console.log(`\nOrigination numbers: NONE registered.`);
    }
  } catch (e) {
    console.log(`\nOrigination     : (query failed) ${(e as Error).message}`);
  }

  // 5. Opted-out check
  if (testPhone) {
    try {
      const opted = await client.send(new ListPhoneNumbersOptedOutCommand({}));
      const isOpted = (opted.phoneNumbers ?? []).includes(testPhone);
      console.log(`\n${testPhone} opted out? ${isOpted ? '⚠️  YES' : 'no'}`);
    } catch (e) {
      console.log(`Opt-out check   : (query failed) ${(e as Error).message}`);
    }

    // 6. Try a test publish
    console.log(`\nAttempting test publish to ${testPhone}...`);
    try {
      const pub = await client.send(
        new PublishCommand({
          PhoneNumber: testPhone,
          Message: 'CMT portal SNS debug ping',
          MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
              DataType: 'String',
              StringValue: 'Transactional',
            },
          },
        }),
      );
      console.log(`  ✓ MessageId: ${pub.MessageId}`);
      console.log(`  (Delivery is async — check your phone in <30s.)`);
    } catch (e) {
      const err = e as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
      console.error(`  ✗ Publish FAILED:`);
      console.error(`    name: ${err.name}`);
      console.error(`    message: ${err.message}`);
      console.error(`    httpStatus: ${err.$metadata?.httpStatusCode ?? '?'}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
