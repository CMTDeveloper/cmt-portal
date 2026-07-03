import { describe, it, expect, afterEach, vi } from 'vitest';

describe('flags.setuDisclaimers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is false when the env var is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS', '');
    const { flags } = await import('../flags');
    expect(flags.setuDisclaimers).toBe(false);
  });

  it('is true only when the env var is exactly "true"', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS', 'true');
    const { flags } = await import('../flags');
    expect(flags.setuDisclaimers).toBe(true);
  });
});
