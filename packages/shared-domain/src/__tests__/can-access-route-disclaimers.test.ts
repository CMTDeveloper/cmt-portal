import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import type { SessionClaims } from '../auth/session';

const manager = { role: 'family-manager', fid: 'CMT-1', mid: 'm1' } as unknown as SessionClaims;
const member = { role: 'family-member', fid: 'CMT-1', mid: 'm2' } as unknown as SessionClaims;
const admin = { role: 'admin', uid: 'u-admin' } as unknown as SessionClaims;
const welcome = { role: 'welcome-team', uid: 'u-w' } as unknown as SessionClaims;

describe('canAccessRoute — disclaimers', () => {
  it('GET /api/setu/disclaimers is any setu family', () => {
    expect(canAccessRoute(manager, '/api/setu/disclaimers', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/disclaimers', 'GET')).toBe(true);
  });
  it('excludes welcome-team from the setu disclaimers API (behavior delta vs the old catch-all)', () => {
    // Inserting the rule BEFORE the /api/setu/ catch-all changes welcome-team
    // from allowed (old catch-all: manager||welcome||admin) to denied
    // (isSetuFamily-only). Pin that intended exclusion (repo directive: tests in
    // the same commit as new branching logic).
    expect(canAccessRoute(welcome, '/api/setu/disclaimers', 'GET')).toBe(false);
    expect(canAccessRoute(welcome, '/api/setu/disclaimers/accept', 'POST')).toBe(false);
  });
  it('POST /api/setu/disclaimers/accept is manager-only', () => {
    expect(canAccessRoute(manager, '/api/setu/disclaimers/accept', 'POST')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/disclaimers/accept', 'POST')).toBe(false);
  });
  it('the /acknowledgements page is any setu family', () => {
    expect(canAccessRoute(manager, '/acknowledgements', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/acknowledgements', 'GET')).toBe(true);
    expect(canAccessRoute(welcome, '/acknowledgements', 'GET')).toBe(false);
  });
  it('admin disclaimers editor + API are admin-only', () => {
    expect(canAccessRoute(admin, '/admin/disclaimers', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/admin/disclaimers', 'PUT')).toBe(true);
    expect(canAccessRoute(manager, '/admin/disclaimers', 'GET')).toBe(false);
    expect(canAccessRoute(welcome, '/api/admin/disclaimers', 'PUT')).toBe(false);
  });
});
