import { describe, it, expect } from 'vitest';
import {
  DisclaimersConfigSchema,
  DEFAULT_DISCLAIMERS_CONFIG,
  isDisclaimerAccepted,
} from '../disclaimers';

describe('DEFAULT_DISCLAIMERS_CONFIG', () => {
  it('is a valid config with version 1 and the five Bala Vihar sections', () => {
    const parsed = DisclaimersConfigSchema.safeParse(DEFAULT_DISCLAIMERS_CONFIG);
    expect(parsed.success).toBe(true);
    expect(DEFAULT_DISCLAIMERS_CONFIG.version).toBe(1);
    expect(DEFAULT_DISCLAIMERS_CONFIG.sections.map((s) => s.id)).toEqual([
      'sacred-spaces',
      'respect-responsibility',
      'seva-community',
      'registration-parent',
      'supervision',
    ]);
  });

  it('carries the intro preamble (with the pledge link) and the acknowledgement statement', () => {
    expect(DEFAULT_DISCLAIMERS_CONFIG.intro).toContain('Hari Om!');
    expect(DEFAULT_DISCLAIMERS_CONFIG.intro).toContain('chinmayatoronto.org/cmpledge');
    expect(DEFAULT_DISCLAIMERS_CONFIG.acknowledgement).toContain('I confirm that I have read');
  });

  it('renders section bodies as newline-separated bullets', () => {
    for (const s of DEFAULT_DISCLAIMERS_CONFIG.sections) {
      expect(s.body.split('\n').every((line) => line.startsWith('• '))).toBe(true);
    }
  });

  it('fixes the source typo (Prasad, not Prassad)', () => {
    const seva = DEFAULT_DISCLAIMERS_CONFIG.sections.find((s) => s.id === 'seva-community')!;
    expect(seva.body).toContain('sponsoring Prasad');
    expect(seva.body).not.toContain('Prassad');
  });

  it('defaults intro/acknowledgement to empty string when a config omits them (read-tolerant)', () => {
    const parsed = DisclaimersConfigSchema.parse({ version: 2, sections: [] });
    expect(parsed.intro).toBe('');
    expect(parsed.acknowledgement).toBe('');
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
