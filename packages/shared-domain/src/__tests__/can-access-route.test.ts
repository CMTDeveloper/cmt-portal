import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import type { SessionClaims } from '../auth/session';

const admin: SessionClaims = { uid: 'a', role: 'admin' };
const teacher: SessionClaims = { uid: 't', role: 'teacher' };
const family: SessionClaims = { uid: 'f', role: 'family', familyId: '42' };
const manager: SessionClaims = { uid: 'm', role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01' };
const member: SessionClaims = { uid: 'mb', role: 'family-member', fid: 'FAM001', mid: 'FAM001-02' };
const welcomeTeam: SessionClaims = { uid: 'w', role: 'welcome-team' };

describe('canAccessRoute — public routes', () => {
  it('allows anyone to access /login', () => {
    expect(canAccessRoute(admin, '/login')).toBe(true);
    expect(canAccessRoute(teacher, '/login')).toBe(true);
    expect(canAccessRoute(family, '/login')).toBe(true);
  });
  it('allows anyone to access /check-in kiosk routes', () => {
    expect(canAccessRoute(family, '/check-in')).toBe(true);
    expect(canAccessRoute(family, '/check-in/guest')).toBe(true);
    expect(canAccessRoute(family, '/check-in/lookup')).toBe(true);
  });
});

describe('canAccessRoute — /check-in/admin', () => {
  it('allows admin', () => {
    expect(canAccessRoute(admin, '/check-in/admin')).toBe(true);
    expect(canAccessRoute(admin, '/check-in/admin/users')).toBe(true);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/check-in/admin')).toBe(false);
  });
  it('denies family', () => {
    expect(canAccessRoute(family, '/check-in/admin')).toBe(false);
  });
});

describe('canAccessRoute — /check-in/teacher', () => {
  it('allows teacher', () => {
    expect(canAccessRoute(teacher, '/check-in/teacher')).toBe(true);
    expect(canAccessRoute(teacher, '/check-in/teacher/attendance')).toBe(true);
  });
  it('allows admin (inherits teacher)', () => {
    expect(canAccessRoute(admin, '/check-in/teacher')).toBe(true);
  });
  it('denies family', () => {
    expect(canAccessRoute(family, '/check-in/teacher')).toBe(false);
  });
});

describe('canAccessRoute — /check-in/family', () => {
  it('allows family', () => {
    expect(canAccessRoute(family, '/check-in/family')).toBe(true);
    expect(canAccessRoute(family, '/check-in/family/check-in')).toBe(true);
  });
  it('denies admin', () => {
    expect(canAccessRoute(admin, '/check-in/family')).toBe(false);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/check-in/family')).toBe(false);
  });
});

describe('canAccessRoute — API surface mirrors pages', () => {
  it('/api/check-in/admin requires admin', () => {
    expect(canAccessRoute(admin, '/api/check-in/admin/users')).toBe(true);
    expect(canAccessRoute(teacher, '/api/check-in/admin/users')).toBe(false);
  });
  it('/api/check-in/teacher requires teacher (admin inherits)', () => {
    expect(canAccessRoute(admin, '/api/check-in/teacher/classlist')).toBe(true);
    expect(canAccessRoute(teacher, '/api/check-in/teacher/classlist')).toBe(true);
    expect(canAccessRoute(family, '/api/check-in/teacher/classlist')).toBe(false);
  });
  it('/api/check-in/family requires family', () => {
    expect(canAccessRoute(family, '/api/check-in/family/dashboard')).toBe(true);
    expect(canAccessRoute(admin, '/api/check-in/family/dashboard')).toBe(false);
  });
});

describe('canAccessRoute — unknown routes default-deny', () => {
  it('denies an unknown protected route', () => {
    expect(canAccessRoute(admin, '/some/unknown/area')).toBe(false);
    expect(canAccessRoute(teacher, '/foo')).toBe(false);
  });
});

// ── Setu roles — H2 follow-up from Slice 2a review ───────────────────────────

describe('canAccessRoute — /family/* — family-manager', () => {
  it('allows family-manager on /family', () => {
    expect(canAccessRoute(manager, '/family')).toBe(true);
  });
  it('allows family-manager on /family/members', () => {
    expect(canAccessRoute(manager, '/family/members')).toBe(true);
  });
  it('allows family-manager on deep sub-route /family/members/FAM001-02', () => {
    expect(canAccessRoute(manager, '/family/members/FAM001-02')).toBe(true);
  });
  it('denies family-manager on /check-in/admin (cross-role)', () => {
    expect(canAccessRoute(manager, '/check-in/admin')).toBe(false);
  });
  it('denies family-manager on /check-in/family (legacy family area)', () => {
    expect(canAccessRoute(manager, '/check-in/family')).toBe(false);
  });
  it('denies family-manager on /welcome (welcome-team area)', () => {
    expect(canAccessRoute(manager, '/welcome')).toBe(false);
  });
});

describe('canAccessRoute — /family/* — family-member', () => {
  it('allows family-member on /family', () => {
    expect(canAccessRoute(member, '/family')).toBe(true);
  });
  it('allows family-member on /family/members', () => {
    expect(canAccessRoute(member, '/family/members')).toBe(true);
  });
  it('denies family-member on /check-in/admin', () => {
    expect(canAccessRoute(member, '/check-in/admin')).toBe(false);
  });
  it('denies family-member on /welcome', () => {
    expect(canAccessRoute(member, '/welcome')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/family* — Setu family roles', () => {
  it('allows family-manager on /api/setu/family', () => {
    expect(canAccessRoute(manager, '/api/setu/family')).toBe(true);
  });
  it('allows family-manager on /api/setu/family/search', () => {
    expect(canAccessRoute(manager, '/api/setu/family/search')).toBe(true);
  });
  it('allows family-member on /api/setu/family', () => {
    expect(canAccessRoute(member, '/api/setu/family')).toBe(true);
  });
  it('denies legacy family role on /api/setu/family', () => {
    expect(canAccessRoute(family, '/api/setu/family')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/members* — Setu family roles', () => {
  it('allows family-manager on /api/setu/members', () => {
    expect(canAccessRoute(manager, '/api/setu/members')).toBe(true);
  });
  it('allows family-manager on /api/setu/members/FAM001-02', () => {
    expect(canAccessRoute(manager, '/api/setu/members/FAM001-02')).toBe(true);
  });
  it('allows family-member on /api/setu/members (middleware level — route handler enforces manager-only for mutations)', () => {
    // NOTE: H1 catch-all gap — canAccessRoute lets family-member reach POST/PATCH/DELETE
    // /api/setu/members at the middleware level because isSetuFamily() covers both roles.
    // Defense-in-depth requires route handlers to check isSetuManager() for mutations.
    // This test documents the CURRENT behavior, not the desired end state.
    expect(canAccessRoute(member, '/api/setu/members')).toBe(true);
  });
  it('denies legacy family role on /api/setu/members', () => {
    expect(canAccessRoute(family, '/api/setu/members')).toBe(false);
  });
});

describe('canAccessRoute — /welcome/* — welcome-team', () => {
  it('allows welcome-team on /welcome', () => {
    expect(canAccessRoute(welcomeTeam, '/welcome')).toBe(true);
  });
  it('allows welcome-team on /welcome/family/FAM001', () => {
    expect(canAccessRoute(welcomeTeam, '/welcome/family/FAM001')).toBe(true);
  });
  it('denies family-manager on /welcome', () => {
    expect(canAccessRoute(manager, '/welcome')).toBe(false);
  });
  it('denies family-member on /welcome', () => {
    expect(canAccessRoute(member, '/welcome')).toBe(false);
  });
  it('denies legacy family role on /welcome', () => {
    expect(canAccessRoute(family, '/welcome')).toBe(false);
  });
  it('denies teacher on /welcome', () => {
    expect(canAccessRoute(teacher, '/welcome')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/* catch-all — H1 gap documentation', () => {
  // The catch-all at canAccessRoute line 35-37 allows isSetuFamily() || isWelcomeTeam() || isAdmin()
  // for any /api/setu/* path not matched by the specific rules above.
  // When Slice 2c/2d add manager-only mutation endpoints, route handlers MUST enforce
  // isSetuManager() internally — middleware alone does not distinguish POST vs GET here.
  it('allows welcome-team on /api/setu/invite/send (future endpoint, covered by catch-all)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/invite/send')).toBe(true);
  });
  it('allows family-manager on /api/setu/invite/send (catch-all)', () => {
    expect(canAccessRoute(manager, '/api/setu/invite/send')).toBe(true);
  });
  it('allows family-member on /api/setu/invite/send (catch-all — H1: route handler must re-enforce)', () => {
    // NOTE: H1 gap — family-member can reach any future /api/setu/* endpoint at middleware level.
    // Each new endpoint must validate the specific required role internally.
    expect(canAccessRoute(member, '/api/setu/invite/send')).toBe(true);
  });
  it('denies legacy family on /api/setu/invite/send', () => {
    expect(canAccessRoute(family, '/api/setu/invite/send')).toBe(false);
  });
  it('denies teacher on /api/setu/invite/send', () => {
    expect(canAccessRoute(teacher, '/api/setu/invite/send')).toBe(false);
  });
});
