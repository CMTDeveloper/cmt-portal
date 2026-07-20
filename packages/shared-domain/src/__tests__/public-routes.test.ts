import { describe, it, expect } from 'vitest';
import { PUBLIC_ROUTES, matchRoute, isPublicRoute } from '../auth/public-routes';

describe('PUBLIC_ROUTES', () => {
  it('includes portal landing', () => {
    expect(PUBLIC_ROUTES).toContain('/');
  });
  it('includes the 2026 Setu sign-in and register entry points', () => {
    expect(PUBLIC_ROUTES).toContain('/sign-in');
    expect(PUBLIC_ROUTES).toContain('/register');
    expect(PUBLIC_ROUTES).toContain('/register/family');
  });
  it('does NOT include /family (now auth-gated)', () => {
    expect(PUBLIC_ROUTES).not.toContain('/family');
    expect(PUBLIC_ROUTES).not.toContain('/family/');
  });
  it('includes the volunteering-skills options GET (the pre-auth register form reads it)', () => {
    expect(PUBLIC_ROUTES).toContain('/api/setu/volunteering-skills');
    expect(isPublicRoute('/api/setu/volunteering-skills')).toBe(true);
  });
  it('includes the token-link review pages (invite + join-request)', () => {
    // Both are public shells whose client handles auth and redirects to
    // /sign-in on 401/403. The join-request page (the emailed "Review request"
    // link) was missing — a signed-in manager got bounced to legacy /login.
    expect(PUBLIC_ROUTES).toContain('/invite/:token');
    expect(PUBLIC_ROUTES).toContain('/join-request/:token');
    expect(isPublicRoute('/join-request/VKHm7ipgMig9ObEo24BSljHlGtlpjjng')).toBe(true);
    expect(isPublicRoute('/invite/abc123')).toBe(true);
    // The manager-only APIs stay gated (not public).
    expect(isPublicRoute('/api/setu/join-request/VKHm7ipgMig9ObEo24BSljHlGtlpjjng')).toBe(false);
  });
  it('includes Setu OTP auth API routes', () => {
    expect(PUBLIC_ROUTES).toContain('/api/setu/auth/send-code');
    expect(PUBLIC_ROUTES).toContain('/api/setu/auth/verify-code');
    expect(PUBLIC_ROUTES).toContain('/api/setu/auth/signout');
  });
  it('includes /login and its sub-paths', () => {
    expect(PUBLIC_ROUTES).toContain('/login');
    expect(PUBLIC_ROUTES).toContain('/login/admin');
    expect(PUBLIC_ROUTES).toContain('/login/teacher');
    expect(PUBLIC_ROUTES).toContain('/login/family');
  });
  it('keeps ONLY the kiosk staff login public (kiosk pages+APIs moved to canAccessRoute)', () => {
    // The kiosk staff login PAGE + its sign-in API stay public - the sevak team
    // has no session yet when they land on them.
    expect(PUBLIC_ROUTES).toContain('/check-in/staff-sign-in');
    expect(PUBLIC_ROUTES).toContain('/api/setu/auth/kiosk-sign-in');
    // The three kiosk pages + four legacy kiosk APIs are no longer public - they
    // are now gated to kiosk-or-admin via canAccessRoute.
    expect(PUBLIC_ROUTES).not.toContain('/check-in');
    expect(PUBLIC_ROUTES).not.toContain('/check-in/guest');
    expect(PUBLIC_ROUTES).not.toContain('/check-in/lookup');
    expect(PUBLIC_ROUTES).not.toContain('/api/check-in/families/:familyId');
    expect(PUBLIC_ROUTES).not.toContain('/api/check-in/families/:familyId/check-in');
    expect(PUBLIC_ROUTES).not.toContain('/api/check-in/lookup');
    expect(PUBLIC_ROUTES).not.toContain('/api/check-in/guests');
  });
  it('includes public auth APIs', () => {
    expect(PUBLIC_ROUTES).toContain('/api/auth/admin/signin');
    expect(PUBLIC_ROUTES).toContain('/api/auth/teacher/signin');
    expect(PUBLIC_ROUTES).toContain('/api/auth/family/send-code');
    expect(PUBLIC_ROUTES).toContain('/api/auth/family/verify-code');
    expect(PUBLIC_ROUTES).toContain('/api/auth/signout');
  });
  it('includes cron routes (their handlers self-verify CRON_SECRET)', () => {
    expect(PUBLIC_ROUTES).toContain('/api/cron/reset-cache');
    expect(PUBLIC_ROUTES).toContain('/api/cron/send-weekly-payment-reminders');
    // Every path scheduled as a cron in vercel.ts must be here, or middleware
    // 401s the Bearer-CRON_SECRET request before the handler runs.
    expect(PUBLIC_ROUTES).toContain('/api/cron/send-prasad-reminders');
  });
});

describe('matchRoute', () => {
  it('exact match', () => {
    expect(matchRoute('/login', '/login')).toBe(true);
    expect(matchRoute('/login', '/login/admin')).toBe(false);
  });
  it('prefix match with trailing /', () => {
    expect(matchRoute('/login/', '/login/admin')).toBe(true);
    expect(matchRoute('/login/', '/loginz')).toBe(false);
  });
  it(':param placeholder matches one segment', () => {
    expect(matchRoute('/api/check-in/families/:familyId', '/api/check-in/families/42')).toBe(true);
    expect(matchRoute('/api/check-in/families/:familyId', '/api/check-in/families/42/check-in')).toBe(
      false,
    );
  });
});

describe('isPublicRoute', () => {
  it('returns true for a listed public route', () => {
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/check-in/staff-sign-in')).toBe(true);
  });
  it('returns false for a protected route', () => {
    expect(isPublicRoute('/check-in/admin')).toBe(false);
    expect(isPublicRoute('/check-in/family')).toBe(false);
    expect(isPublicRoute('/family')).toBe(false);
    expect(isPublicRoute('/family/members')).toBe(false);
  });
  it('no longer treats the kiosk pages + legacy kiosk APIs as public (now kiosk-or-admin)', () => {
    expect(isPublicRoute('/check-in')).toBe(false);
    expect(isPublicRoute('/check-in/guest')).toBe(false);
    expect(isPublicRoute('/check-in/lookup')).toBe(false);
    expect(isPublicRoute('/api/check-in/families/1075')).toBe(false);
    expect(isPublicRoute('/api/check-in/families/1075/check-in')).toBe(false);
    expect(isPublicRoute('/api/check-in/lookup')).toBe(false);
    expect(isPublicRoute('/api/check-in/guests')).toBe(false);
  });
  it('keeps the kiosk staff login page + sign-in API public (they ARE the login)', () => {
    expect(isPublicRoute('/check-in/staff-sign-in')).toBe(true);
    expect(isPublicRoute('/api/setu/auth/kiosk-sign-in')).toBe(true);
  });
  it('returns true for Setu OTP auth APIs', () => {
    expect(isPublicRoute('/api/setu/auth/send-code')).toBe(true);
    expect(isPublicRoute('/api/setu/auth/verify-code')).toBe(true);
    expect(isPublicRoute('/api/setu/auth/signout')).toBe(true);
  });
  it('returns true for :param route matches', () => {
    expect(isPublicRoute('/api/setu/auth/magic/abc123')).toBe(true);
  });
  it('returns true for cron routes (self-verify CRON_SECRET in their handlers)', () => {
    expect(isPublicRoute('/api/cron/reset-cache')).toBe(true);
    expect(isPublicRoute('/api/cron/send-weekly-payment-reminders')).toBe(true);
    expect(isPublicRoute('/api/cron/send-prasad-reminders')).toBe(true);
  });
  it('makes ONLY join-request/send public (the rest is manager-only)', () => {
    // The requester is mid-registration with no session, so /send must skip the
    // middleware session gate; everything else under join-request is auth-gated.
    expect(isPublicRoute('/api/setu/join-request/send')).toBe(true);
    expect(isPublicRoute('/api/setu/join-request')).toBe(false);
    expect(isPublicRoute('/api/setu/join-request/approve')).toBe(false);
    expect(isPublicRoute('/api/setu/join-request/decline')).toBe(false);
    expect(isPublicRoute('/api/setu/join-request/sometoken')).toBe(false);
  });
});
