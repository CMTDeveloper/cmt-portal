import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import type { SessionClaims } from '../auth/session';

// Multi-role scenarios — a single user can carry admin/welcome-team in
// extraRoles on top of a family-manager primary. These tests pin the
// behavior that capability checks honor BOTH `role` and `extraRoles`.

const fm = (overrides: Partial<SessionClaims> = {}): SessionClaims => ({
  uid: 'u1',
  role: 'family-manager',
  fid: 'F1',
  mid: 'F1-01',
  ...overrides,
});

describe('canAccessRoute — admin capability via extraRoles', () => {
  it('family-manager with extraRoles=[admin] can access /admin page', () => {
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/admin')).toBe(true);
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/admin/welcome-team')).toBe(true);
  });
  it('family-manager with extraRoles=[admin] can access /api/admin/* (any method)', () => {
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/api/admin/welcome-team', 'GET')).toBe(true);
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/api/admin/welcome-team', 'POST')).toBe(true);
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/api/admin/welcome-team/uid-123', 'DELETE')).toBe(true);
  });
  it('family-manager without admin in extras cannot access /admin', () => {
    expect(canAccessRoute(fm(), '/admin')).toBe(false);
    expect(canAccessRoute(fm({ extraRoles: ['welcome-team'] }), '/admin')).toBe(false);
  });
  it('pure admin user still has /admin access', () => {
    const admin: SessionClaims = { uid: 'u2', role: 'admin' };
    expect(canAccessRoute(admin, '/admin')).toBe(true);
    expect(canAccessRoute(admin, '/api/admin/welcome-team', 'POST')).toBe(true);
  });
  it('legacy /check-in/admin still gated by isAdmin (admin in extras passes)', () => {
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/check-in/admin')).toBe(true);
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/api/check-in/admin/welcome-team', 'POST')).toBe(true);
  });
});

describe('canAccessRoute — welcome-team capability via extraRoles', () => {
  it('family-manager with extraRoles=[welcome-team] can access /welcome', () => {
    expect(canAccessRoute(fm({ extraRoles: ['welcome-team'] }), '/welcome')).toBe(true);
    expect(canAccessRoute(fm({ extraRoles: ['welcome-team'] }), '/welcome/family/FAM001')).toBe(true);
  });
  it('admin user can access /welcome (admin inherits welcome-team capability)', () => {
    const admin: SessionClaims = { uid: 'u2', role: 'admin' };
    expect(canAccessRoute(admin, '/welcome')).toBe(true);
    expect(canAccessRoute(admin, '/api/setu/family/search?q=foo')).toBe(true);
  });
  it('family-manager without welcome-team in extras cannot access /welcome', () => {
    expect(canAccessRoute(fm(), '/welcome')).toBe(false);
  });
});

describe('canAccessRoute — family routes unaffected by extras', () => {
  it('family-manager with admin extra still hits family-manager checks (e.g. POST members)', () => {
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/api/setu/members', 'POST')).toBe(true);
    expect(canAccessRoute(fm({ extraRoles: ['admin'] }), '/family')).toBe(true);
  });
  it('family-member with admin extra still gated for manager-only writes', () => {
    const fmem = fm({ role: 'family-member', extraRoles: ['admin'] });
    expect(canAccessRoute(fmem, '/api/setu/members', 'POST')).toBe(false);
    expect(canAccessRoute(fmem, '/api/setu/members', 'GET')).toBe(true);
  });
});
