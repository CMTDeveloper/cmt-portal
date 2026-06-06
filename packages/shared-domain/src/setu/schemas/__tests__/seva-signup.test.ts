import { describe, it, expect } from 'vitest';
import { SevaSignupDocSchema, CreateSevaSignupSchema } from '../seva';

describe('SevaSignupDocSchema', () => {
  const base = {
    signupId: 'o1__CMT-AB12CD34', oppId: 'o1', fid: 'CMT-AB12CD34', mid: null,
    sevaYear: '2025-26', status: 'signed-up' as const, hoursAwarded: 0,
    signedUpAt: new Date(), signedUpByMid: 'CMT-AB12CD34-01',
    confirmedAt: null, confirmedBy: null,
  };
  it('parses a valid signed-up record', () => {
    expect(SevaSignupDocSchema.parse(base).status).toBe('signed-up');
  });
  it('accepts a member credit + completed status with hours', () => {
    const p = SevaSignupDocSchema.parse({ ...base, mid: 'CMT-AB12CD34-02', status: 'completed', hoursAwarded: 4, confirmedAt: new Date(), confirmedBy: 'u-staff' });
    expect(p.hoursAwarded).toBe(4);
  });
  it('rejects an unknown status and negative hours', () => {
    expect(SevaSignupDocSchema.safeParse({ ...base, status: 'maybe' }).success).toBe(false);
    expect(SevaSignupDocSchema.safeParse({ ...base, hoursAwarded: -1 }).success).toBe(false);
  });
});

describe('CreateSevaSignupSchema', () => {
  it('requires oppId, defaults mid to null', () => {
    expect(CreateSevaSignupSchema.parse({ oppId: 'o1' }).mid).toBeNull();
  });
  it('keeps a provided mid', () => {
    expect(CreateSevaSignupSchema.parse({ oppId: 'o1', mid: 'CMT-AB12CD34-02' }).mid).toBe('CMT-AB12CD34-02');
  });
  it('rejects a missing oppId', () => {
    expect(CreateSevaSignupSchema.safeParse({}).success).toBe(false);
  });
});
