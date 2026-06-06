import { describe, it, expect } from 'vitest';
import { ConfirmSevaSignupSchema } from '../seva';

describe('ConfirmSevaSignupSchema', () => {
  it('accepts completed with explicit hours', () => {
    const p = ConfirmSevaSignupSchema.parse({ status: 'completed', hoursAwarded: 4 });
    expect(p.status).toBe('completed');
    expect(p.hoursAwarded).toBe(4);
  });
  it('accepts completed with no hours (confirmer accepts default later)', () => {
    const p = ConfirmSevaSignupSchema.parse({ status: 'completed' });
    expect(p.hoursAwarded).toBeUndefined();
  });
  it('accepts no-show', () => {
    expect(ConfirmSevaSignupSchema.parse({ status: 'no-show' }).status).toBe('no-show');
  });
  it('rejects signed-up / cancelled as a confirm target', () => {
    expect(ConfirmSevaSignupSchema.safeParse({ status: 'signed-up' }).success).toBe(false);
    expect(ConfirmSevaSignupSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });
  it('rejects negative hours', () => {
    expect(ConfirmSevaSignupSchema.safeParse({ status: 'completed', hoursAwarded: -1 }).success).toBe(false);
  });
});
