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

  it('rejects backslashes (browser/URL parser treat \\ as / in the authority)', () => {
    // `/\evil.example` — the reported open-redirect vector; resolves cross-origin.
    expect(isSafeInternalPath('/\\evil.example')).toBe(false);
    expect(isSafeInternalPath('/\\/evil')).toBe(false);
    expect(isSafeInternalPath('/\\\\evil')).toBe(false);
    expect(isSafeInternalPath('/foo\\bar')).toBe(false);
  });

  it('rejects control characters (host smuggling)', () => {
    for (const code of [0, 9, 10, 13, 31, 127]) {
      expect(isSafeInternalPath('/' + String.fromCharCode(code) + 'evil')).toBe(false);
    }
  });
});
