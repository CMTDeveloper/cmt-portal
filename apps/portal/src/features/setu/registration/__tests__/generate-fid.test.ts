import { describe, it, expect } from 'vitest';
import { generateFid, isCmtFid, FID_PREFIX } from '../generate-fid';

describe('generateFid', () => {
  it('starts with CMT- prefix', () => {
    for (let i = 0; i < 20; i++) {
      const fid = generateFid();
      expect(fid.startsWith(FID_PREFIX)).toBe(true);
      expect(fid.startsWith('CMT-')).toBe(true);
    }
  });

  it('has total length 12 (prefix + 8 random chars)', () => {
    expect(generateFid()).toHaveLength(12);
  });

  it('random portion is uppercase A–Z or 0–9', () => {
    const fid = generateFid();
    const random = fid.slice(FID_PREFIX.length);
    expect(random).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('produces unique IDs across many calls (probabilistic)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateFid());
    expect(set.size).toBe(200);
  });
});

describe('isCmtFid', () => {
  it('matches freshly-generated FIDs', () => {
    for (let i = 0; i < 10; i++) {
      expect(isCmtFid(generateFid())).toBe(true);
    }
  });
  it('rejects legacy 12-char no-prefix FIDs', () => {
    expect(isCmtFid('GY9OART03HDC')).toBe(false);
  });
  it('rejects shorter/longer CMT-prefixed strings', () => {
    expect(isCmtFid('CMT-A1B2C3D')).toBe(false);   // 7 chars
    expect(isCmtFid('CMT-A1B2C3D4E')).toBe(false); // 9 chars
  });
  it('rejects lowercase characters', () => {
    expect(isCmtFid('CMT-abcd1234')).toBe(false);
  });
  it('rejects non-CMT prefixes', () => {
    expect(isCmtFid('XYZ-A1B2C3D4')).toBe(false);
    expect(isCmtFid('A1B2C3D4ABCD')).toBe(false);
  });
});
