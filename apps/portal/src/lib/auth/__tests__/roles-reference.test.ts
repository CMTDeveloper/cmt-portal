import { describe, it, expect } from 'vitest';
import { ROLES } from '@cmt/shared-domain';
import { ROLE_REFERENCE, ROLE_REFERENCE_ORDER } from '../roles-reference';

describe('ROLE_REFERENCE', () => {
  it('covers every role in ROLES', () => {
    for (const role of ROLES) {
      expect(ROLE_REFERENCE[role]).toBeDefined();
    }
    // No stray keys beyond ROLES.
    expect(Object.keys(ROLE_REFERENCE).sort()).toEqual([...ROLES].sort());
  });

  it('every entry has a non-empty label, summary, and at least one grant', () => {
    for (const role of ROLES) {
      const ref = ROLE_REFERENCE[role];
      expect(ref.label.length).toBeGreaterThan(0);
      expect(ref.summary.length).toBeGreaterThan(0);
      expect(ref.grants.length).toBeGreaterThan(0);
      for (const g of ref.grants) {
        expect(g.length).toBeGreaterThan(0);
      }
    }
  });

  it('ROLE_REFERENCE_ORDER lists each role exactly once', () => {
    expect([...ROLE_REFERENCE_ORDER].sort()).toEqual([...ROLES].sort());
    expect(new Set(ROLE_REFERENCE_ORDER).size).toBe(ROLE_REFERENCE_ORDER.length);
  });
});
