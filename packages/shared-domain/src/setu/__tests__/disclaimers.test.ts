import { describe, it, expect } from 'vitest';
import {
  DisclaimersConfigSchema,
  DEFAULT_DISCLAIMERS_CONFIG,
  isDisclaimerAccepted,
} from '../disclaimers';

describe('DEFAULT_DISCLAIMERS_CONFIG', () => {
  it('is a valid config with version 1 and four seed sections', () => {
    const parsed = DisclaimersConfigSchema.safeParse(DEFAULT_DISCLAIMERS_CONFIG);
    expect(parsed.success).toBe(true);
    expect(DEFAULT_DISCLAIMERS_CONFIG.version).toBe(1);
    expect(DEFAULT_DISCLAIMERS_CONFIG.sections).toHaveLength(4);
    expect(DEFAULT_DISCLAIMERS_CONFIG.sections.map((s) => s.id)).toEqual([
      'respect-responsibility',
      'sacred-spaces',
      'community-values',
      'chinmaya-values',
    ]);
  });
});

describe('isDisclaimerAccepted', () => {
  const config = { version: 3 };
  const YEAR = '2026-27';

  it('true when year matches and version >= current', () => {
    expect(isDisclaimerAccepted({ schoolYear: '2026-27', version: 3 }, config, YEAR)).toBe(true);
    expect(isDisclaimerAccepted({ schoolYear: '2026-27', version: 4 }, config, YEAR)).toBe(true);
  });
  it('false when the accepted version is older than current', () => {
    expect(isDisclaimerAccepted({ schoolYear: '2026-27', version: 2 }, config, YEAR)).toBe(false);
  });
  it('false when the accepted school year differs (yearly reset)', () => {
    expect(isDisclaimerAccepted({ schoolYear: '2025-26', version: 3 }, config, YEAR)).toBe(false);
  });
  it('false when there is no acceptance record', () => {
    expect(isDisclaimerAccepted(null, config, YEAR)).toBe(false);
    expect(isDisclaimerAccepted(undefined, config, YEAR)).toBe(false);
  });
});
