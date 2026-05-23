import { describe, it, expect } from 'vitest';
import { hashContactKey } from '../hash-contact-key';

describe('hashContactKey', () => {
  it('email: case-insensitive — uppercase and lowercase produce same hash', () => {
    expect(hashContactKey('email', 'Foo@Bar.com')).toBe(hashContactKey('email', 'foo@bar.com'));
  });

  it('email: trims whitespace before hashing', () => {
    expect(hashContactKey('email', '  raj@example.com  ')).toBe(
      hashContactKey('email', 'raj@example.com'),
    );
  });

  it('phone: strips non-digits — formatted and raw produce same hash', () => {
    expect(hashContactKey('phone', '(416) 555-2204')).toBe(hashContactKey('phone', '+14165552204'));
  });

  it('phone: 10-digit and +1-prefixed 11-digit produce same hash', () => {
    expect(hashContactKey('phone', '4165552204')).toBe(hashContactKey('phone', '+14165552204'));
  });

  it('produces a 64-character hex string (sha256)', () => {
    const hash = hashContactKey('email', 'test@example.com');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different contacts produce different hashes', () => {
    expect(hashContactKey('email', 'a@example.com')).not.toBe(
      hashContactKey('email', 'b@example.com'),
    );
  });

  it('email and phone with same raw value produce different hashes', () => {
    expect(hashContactKey('email', '4165550000')).not.toBe(hashContactKey('phone', '4165550000'));
  });
});
