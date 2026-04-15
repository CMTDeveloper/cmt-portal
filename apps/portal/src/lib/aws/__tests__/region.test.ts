import { describe, it, expect, beforeEach } from 'vitest';
import { sesRegion, snsRegion } from '../region';

beforeEach(() => {
  delete process.env.AWS_SES_REGION;
  delete process.env.AWS_SNS_REGION;
});

describe('sesRegion', () => {
  it('returns env when set', () => {
    process.env.AWS_SES_REGION = 'us-west-2';
    expect(sesRegion()).toBe('us-west-2');
  });
  it('defaults to ca-central-1', () => {
    expect(sesRegion()).toBe('ca-central-1');
  });
});

describe('snsRegion', () => {
  it('returns env when set', () => {
    process.env.AWS_SNS_REGION = 'eu-west-1';
    expect(snsRegion()).toBe('eu-west-1');
  });
  it('defaults to us-east-1', () => {
    expect(snsRegion()).toBe('us-east-1');
  });
});
