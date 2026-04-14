import { describe, it, expect } from 'vitest';
import { normalizeContact } from '../contact/normalize';
import { sha256Hex } from '../contact/hash';

describe('normalizeContact', () => {
  it('lowercases and trims email', () => {
    expect(normalizeContact('email', '  ALICE@Example.com  ')).toBe('alice@example.com');
  });

  it('strips phone to digits only', () => {
    expect(normalizeContact('phone', '+1 (647) 555-0100')).toBe('16475550100');
  });
});

describe('sha256Hex', () => {
  it('produces a 64-char hex string', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
