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
  it('includes kiosk routes', () => {
    expect(PUBLIC_ROUTES).toContain('/check-in');
    expect(PUBLIC_ROUTES).toContain('/check-in/guest');
    expect(PUBLIC_ROUTES).toContain('/check-in/lookup');
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
    expect(isPublicRoute('/check-in/guest')).toBe(true);
  });
  it('returns false for a protected route', () => {
    expect(isPublicRoute('/check-in/admin')).toBe(false);
    expect(isPublicRoute('/check-in/family')).toBe(false);
    expect(isPublicRoute('/family')).toBe(false);
    expect(isPublicRoute('/family/members')).toBe(false);
  });
  it('returns true for Setu OTP auth APIs', () => {
    expect(isPublicRoute('/api/setu/auth/send-code')).toBe(true);
    expect(isPublicRoute('/api/setu/auth/verify-code')).toBe(true);
    expect(isPublicRoute('/api/setu/auth/signout')).toBe(true);
  });
  it('returns true for :param route matches', () => {
    expect(isPublicRoute('/api/check-in/families/42')).toBe(true);
  });
  it('returns true for cron routes (self-verify CRON_SECRET in their handlers)', () => {
    expect(isPublicRoute('/api/cron/reset-cache')).toBe(true);
    expect(isPublicRoute('/api/cron/send-weekly-payment-reminders')).toBe(true);
  });
});
