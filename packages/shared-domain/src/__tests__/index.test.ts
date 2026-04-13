import { describe, it, expect } from 'vitest';
import * as sharedDomain from '../index';

describe('@cmt/shared-domain', () => {
  it('exports a barrel that loads without throwing', () => {
    expect(sharedDomain).toBeDefined();
  });

  it('is empty in slice A (no exports yet)', () => {
    expect(Object.keys(sharedDomain)).toEqual([]);
  });
});
