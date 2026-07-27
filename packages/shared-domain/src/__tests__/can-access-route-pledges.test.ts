import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import { isPublicRoute } from '../auth/public-routes';
import type { SessionClaims } from '../auth/session';

const manager = { role: 'family-manager', fid: 'CMT-1', mid: 'm1' } as unknown as SessionClaims;
const member = { role: 'family-member', fid: 'CMT-1', mid: 'm2' } as unknown as SessionClaims;
const admin = { role: 'admin', uid: 'u-admin' } as unknown as SessionClaims;
const welcome = { role: 'welcome-team', uid: 'u-w' } as unknown as SessionClaims;
const coordinator = { role: 'coordinator', uid: 'u-c' } as unknown as SessionClaims;
const teacher = { role: 'family-manager', fid: 'CMT-2', mid: 'm3', extraRoles: ['teacher'] } as unknown as SessionClaims;
const kiosk = { role: 'kiosk', uid: 'u-k' } as unknown as SessionClaims;

/**
 * `/api/pledges/*` starts a RECURRING DEBIT against a family. It lives outside
 * `/api/setu/*` precisely so it cannot inherit that prefix's catch-all, which
 * grants welcome-team and admin. The point of these tests is the exclusions.
 */
describe('canAccessRoute - pledges', () => {
  it('allows a family-manager', () => {
    expect(canAccessRoute(manager, '/api/pledges/start', 'POST')).toBe(true);
    expect(canAccessRoute(manager, '/api/pledges/finalize', 'POST')).toBe(true);
  });

  it('denies EVERY non-manager role, including admin and welcome-team', () => {
    // Not an oversight: nobody should be able to commit a family to a monthly
    // debit on their behalf. Admin is denied here and gets a separate,
    // bookkeeping-only cancel route under /api/admin/pledges instead.
    for (const [label, who] of [
      ['family-member', member],
      ['welcome-team', welcome],
      ['admin', admin],
      ['coordinator', coordinator],
      ['kiosk', kiosk],
    ] as const) {
      expect(canAccessRoute(who, '/api/pledges/start', 'POST'), `${label} must not start a pledge`).toBe(false);
    }
  });

  it('allows a manager who also happens to be a teacher (multi-role claims)', () => {
    // The role check must be capability-based, not strict equality on `role`.
    expect(canAccessRoute(teacher, '/api/pledges/start', 'POST')).toBe(true);
  });

  it('is NOT public - the gate that runs first must not wave it through', () => {
    // isPublicRoute is consulted BEFORE canAccessRoute in middleware, so a path
    // listed there would skip every check above.
    expect(isPublicRoute('/api/pledges/start')).toBe(false);
    expect(isPublicRoute('/api/pledges/finalize')).toBe(false);
  });

  it('denies an unknown pledge sub-path rather than falling through to allowed', () => {
    // canAccessRoute ends in `return false`, but the rule is a prefix match, so
    // pin that a future sub-route is manager-gated by default rather than open.
    expect(canAccessRoute(welcome, '/api/pledges/anything-new', 'POST')).toBe(false);
    expect(canAccessRoute(manager, '/api/pledges/anything-new', 'POST')).toBe(true);
  });

  it('does not accidentally match a DIFFERENT path that merely starts with the same letters', () => {
    // `/api/pledgesomething` must not be treated as a pledge route.
    expect(canAccessRoute(manager, '/api/pledgesomething', 'POST')).toBe(false);
  });
});
