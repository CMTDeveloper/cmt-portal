import { describe, it, expect } from 'vitest';
import { assertNotLastManager, LastManagerError } from '../last-manager-guard';

const family = (managers: string[]) => ({ managers });

describe('assertNotLastManager — remove', () => {
  it('throws when removing the only manager', () => {
    expect(() => assertNotLastManager(family(['m-01']), 'm-01', 'remove')).toThrow(LastManagerError);
  });

  it('throws with a meaningful message', () => {
    expect(() => assertNotLastManager(family(['m-01']), 'm-01', 'remove')).toThrow(
      'Cannot remove the last manager',
    );
  });

  it('succeeds when removing one of two managers', () => {
    expect(() => assertNotLastManager(family(['m-01', 'm-02']), 'm-01', 'remove')).not.toThrow();
  });

  it('succeeds when removing a non-manager member', () => {
    expect(() => assertNotLastManager(family(['m-01']), 'm-99', 'remove')).not.toThrow();
  });
});

describe('assertNotLastManager — demote', () => {
  it('throws when demoting the only manager', () => {
    expect(() => assertNotLastManager(family(['m-01']), 'm-01', 'demote')).toThrow(LastManagerError);
  });

  it('throws with a meaningful message', () => {
    expect(() => assertNotLastManager(family(['m-01']), 'm-01', 'demote')).toThrow(
      'Cannot demote the last manager',
    );
  });

  it('succeeds when demoting one of two managers', () => {
    expect(() => assertNotLastManager(family(['m-01', 'm-02']), 'm-01', 'demote')).not.toThrow();
  });

  it('succeeds when demoting a non-manager member', () => {
    expect(() => assertNotLastManager(family(['m-01']), 'm-99', 'demote')).not.toThrow();
  });
});

describe('LastManagerError identity', () => {
  it('is instanceof Error', () => {
    try {
      assertNotLastManager(family(['m-01']), 'm-01', 'remove');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(LastManagerError);
    }
  });
});
