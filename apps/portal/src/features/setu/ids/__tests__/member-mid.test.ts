import { describe, it, expect } from 'vitest';
import { nextMemberMid } from '../member-mid';

const FID = 'CMT-AI55HB3E';

describe('nextMemberMid', () => {
  it('appends after the highest suffix in a gap-free family', () => {
    expect(nextMemberMid(FID, [`${FID}-01`, `${FID}-02`, `${FID}-03`])).toBe(`${FID}-04`);
  });

  it('does NOT reuse a gap left by a deletion (the Rana-family data-loss bug)', () => {
    // Vaibhav's family after the wife (-02) was deleted: -01, -03, -04. The old
    // count+1 logic computed -04 and OVERWROTE Harshita. Max+1 must yield -05.
    expect(nextMemberMid(FID, [`${FID}-01`, `${FID}-03`, `${FID}-04`])).toBe(`${FID}-05`);
  });

  it('gives the second member -02 when only the manager exists', () => {
    expect(nextMemberMid(FID, [`${FID}-01`])).toBe(`${FID}-02`);
  });

  it('starts at -01 for an empty family', () => {
    expect(nextMemberMid(FID, [])).toBe(`${FID}-01`);
  });

  it('is max+1, not count+1 (a family whose lowest members were deleted)', () => {
    // Only -03 and -04 remain (older members deleted). count+1 would give -03
    // (collision!); max+1 gives -05.
    expect(nextMemberMid(FID, [`${FID}-03`, `${FID}-04`])).toBe(`${FID}-05`);
  });

  it('counts an unpadded suffix so it is never collided with', () => {
    // A legacy id stored unpadded (-4) still parses to 4, so max+1 is -05.
    expect(nextMemberMid(FID, [`${FID}-01`, `${FID}-4`])).toBe(`${FID}-05`);
  });

  it('ignores ids that do not belong to this family or have non-numeric suffixes', () => {
    expect(
      nextMemberMid(FID, [`${FID}-01`, `${FID}-02`, 'OTHER-FID-99', `${FID}-legacy`]),
    ).toBe(`${FID}-03`);
  });

  it('handles suffixes past 99 without truncating', () => {
    expect(nextMemberMid(FID, [`${FID}-99`])).toBe(`${FID}-100`);
  });
});
