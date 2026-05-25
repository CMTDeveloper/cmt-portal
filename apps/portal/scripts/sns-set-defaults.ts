/**
 * One-shot: set sane account-level SNS SMS defaults in ca-central-1 so
 * delivery isn't fighting Promotional defaults or low spend caps.
 *
 * Sets:
 *   DefaultSMSType = Transactional       (account-wide OTP priority)
 *   MonthlySpendLimit = 10               (10x default to survive UAT bursts)
 *   DefaultSenderID = ChinmayaCMT        (where supported — not US/CA so this is a no-op there)
 *
 * Then prints the resulting attributes.
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local \
 *     scripts/sns-set-defaults.ts
 */

import {
  SNSClient,
  SetSMSAttributesCommand,
  GetSMSAttributesCommand,
} from '@aws-sdk/client-sns';

async function main() {
  const region = process.env.AWS_SNS_REGION ?? 'ca-central-1';
  const client = new SNSClient({ region });
  console.log(`Region: ${region}\n`);

  console.log('Before:');
  const before = await client.send(new GetSMSAttributesCommand({}));
  for (const [k, v] of Object.entries(before.attributes ?? {})) console.log(`  ${k} = ${v}`);

  console.log('\nSetting DefaultSMSType=Transactional, MonthlySpendLimit=10 ...');
  try {
    await client.send(
      new SetSMSAttributesCommand({
        attributes: {
          DefaultSMSType: 'Transactional',
          MonthlySpendLimit: '10',
        },
      }),
    );
    console.log('  ✓ Applied');
  } catch (e) {
    console.error(`  ✗ Failed: ${(e as Error).message}`);
  }

  console.log('\nAfter:');
  const after = await client.send(new GetSMSAttributesCommand({}));
  for (const [k, v] of Object.entries(after.attributes ?? {})) console.log(`  ${k} = ${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
