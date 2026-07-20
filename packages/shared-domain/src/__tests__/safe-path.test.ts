import { describe, it, expect } from 'vitest';
import { isSafeInternalPath } from '../auth/safe-path';

describe('isSafeInternalPath', () => {
  it('accepts same-origin absolute paths', () => {
    expect(isSafeInternalPath('/')).toBe(true);
    expect(isSafeInternalPath('/family')).toBe(true);
    expect(isSafeInternalPath('/check-in/guest')).toBe(true);
    expect(isSafeInternalPath('/family/members?tab=x')).toBe(true);
  });

  it('rejects protocol-relative and absolute URLs (open-redirect vectors)', () => {
    expect(isSafeInternalPath('//evil.com')).toBe(false);
    expect(isSafeInternalPath('https://evil.com')).toBe(false);
    expect(isSafeInternalPath('/x://y')).toBe(false);
    expect(isSafeInternalPath('http://x')).toBe(false);
  });

  it('rejects non-absolute and empty/nullish values', () => {
    expect(isSafeInternalPath('family')).toBe(false);
    expect(isSafeInternalPath('')).toBe(false);
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
  });
});
