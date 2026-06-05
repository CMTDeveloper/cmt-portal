import { describe, it, expect } from 'vitest';
import type { SetuContactKeyDoc } from '../find-family-by-contact';

describe('SetuContactKeyDoc — source/verifiedAt', () => {
  it('accepts a self-verified contactKey shape', () => {
    const doc: SetuContactKeyDoc = {
      contactKey: 'abc',
      type: 'email',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      source: 'self-verified',
      verifiedAt: new Date(),
    };
    expect(doc.source).toBe('self-verified');
    expect(doc.verifiedAt).toBeInstanceOf(Date);
  });

  it('accepts a registration contactKey with no source/verifiedAt (legacy doc)', () => {
    const doc: SetuContactKeyDoc = {
      contactKey: 'abc',
      type: 'phone',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-01',
    };
    expect(doc.source).toBeUndefined();
  });
});
