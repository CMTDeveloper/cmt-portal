import 'server-only';

export function sesRegion(): string {
  return process.env.AWS_SES_REGION ?? 'ca-central-1';
}

export function snsRegion(): string {
  return process.env.AWS_SNS_REGION ?? 'us-east-1';
}
