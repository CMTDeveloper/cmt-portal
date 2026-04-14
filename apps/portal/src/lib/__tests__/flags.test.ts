import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('flags', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY;
  });

  it('returns false by default for all check-in sub-flags', async () => {
    const { flags } = await import('../flags');
    expect(flags.checkIn).toBe(false);
    expect(flags.checkInKiosk).toBe(false);
    expect(flags.checkInFamily).toBe(false);
    expect(flags.checkInTeacher).toBe(false);
    expect(flags.checkInAdmin).toBe(false);
    expect(flags.checkInNotify).toBe(false);
  });

  it('AND-gates sub-flags with master checkIn', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'false';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN = 'true';
    const { flags } = await import('../flags');
    expect(flags.checkInAdmin).toBe(false);
  });

  it('returns true when both master and sub-flag are on', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'true';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN = 'true';
    const { flags } = await import('../flags');
    expect(flags.checkInAdmin).toBe(true);
  });
});
