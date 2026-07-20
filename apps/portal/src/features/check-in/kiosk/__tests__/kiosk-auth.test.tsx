import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKioskAuthExpiry } from '../kiosk-auth';

beforeEach(() => {
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('handleKioskAuthExpiry', () => {
  it('on a 401 returns true and hard-navigates to the staff sign-in with session-expired', () => {
    const res = { status: 401 } as Response;
    expect(handleKioskAuthExpiry(res)).toBe(true);
    expect(window.location.assign).toHaveBeenCalledWith(
      '/check-in/staff-sign-in?error=session-expired',
    );
  });

  it('on a 200 returns false and does not navigate', () => {
    const res = { status: 200 } as Response;
    expect(handleKioskAuthExpiry(res)).toBe(false);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('on a 404 returns false and does not navigate (family-lookup 404 path unaffected)', () => {
    const res = { status: 404 } as Response;
    expect(handleKioskAuthExpiry(res)).toBe(false);
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
