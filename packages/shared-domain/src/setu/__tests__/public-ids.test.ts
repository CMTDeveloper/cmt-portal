import { describe, it, expect } from 'vitest';
import { displayFid, displayMid } from '../public-ids';

describe('public-id display helpers', () => {
  it('prefers the public id when present', () => {
    expect(displayFid({ publicFid: '1042', fid: 'CMT-A1B2C3D4' })).toBe('1042');
    expect(displayMid({ publicMid: '50001', mid: 'CMT-A1B2C3D4-01' })).toBe('50001');
  });
  it('falls back to the legacy id when the public id is null/absent', () => {
    expect(displayFid({ publicFid: null, fid: 'CMT-A1B2C3D4' })).toBe('CMT-A1B2C3D4');
    expect(displayFid({ fid: 'CMT-A1B2C3D4' })).toBe('CMT-A1B2C3D4');
    expect(displayMid({ mid: 'CMT-A1B2C3D4-01' })).toBe('CMT-A1B2C3D4-01');
  });
});
