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

describe('canAccessRoute — /api/setu/family-lookup is public', () => {
  it('allows unauthenticated (no session) via isPublicRoute', () => {
    // Middleware calls isPublicRoute before canAccessRoute; canAccessRoute is
    // only reached for authenticated sessions. These tests confirm the route
    // passes for every authenticated role too (no accidental denial).
    expect(canAccessRoute(admin, '/api/setu/family-lookup')).toBe(true);
    expect(canAccessRoute(manager, '/api/setu/family-lookup')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/setu/family-lookup')).toBe(true);
    expect(canAccessRoute(family, '/api/setu/family-lookup')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/family-lookup')).toBe(true);
  });
});

describe('canAccessRoute — /api/setu/register is public', () => {
  it('allows every authenticated role via isPublicRoute', () => {
    expect(canAccessRoute(admin, '/api/setu/register')).toBe(true);
    expect(canAccessRoute(manager, '/api/setu/register')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/setu/register')).toBe(true);
    expect(canAccessRoute(family, '/api/setu/register')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/register')).toBe(true);
  });
});

describe('canAccessRoute — unknown routes default-deny', () => {
  it('denies an unknown protected route', () => {
    expect(canAccessRoute(admin, '/some/unknown/area')).toBe(false);
    expect(canAccessRoute(teacher, '/foo')).toBe(false);
  });
});

// ── Setu roles ────────────────────────────────────────────────────────────────

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

describe('canAccessRoute — /api/setu/family — GET (read)', () => {
  it('allows family-manager GET /api/setu/family', () => {
    expect(canAccessRoute(manager, '/api/setu/family', 'GET')).toBe(true);
  });
  it('allows family-member GET /api/setu/family', () => {
    expect(canAccessRoute(member, '/api/setu/family', 'GET')).toBe(true);
  });
  it('denies legacy family role GET /api/setu/family', () => {
    expect(canAccessRoute(family, '/api/setu/family', 'GET')).toBe(false);
  });
  it('defaults to GET when method omitted', () => {
    expect(canAccessRoute(manager, '/api/setu/family')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/family')).toBe(true);
  });
});

describe('canAccessRoute — /api/setu/family/search — welcome-team only', () => {
  it('allows welcome-team GET /api/setu/family/search', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/family/search', 'GET')).toBe(true);
  });
  it('denies family-manager GET /api/setu/family/search', () => {
    expect(canAccessRoute(manager, '/api/setu/family/search', 'GET')).toBe(false);
  });
  it('denies family-member GET /api/setu/family/search', () => {
    expect(canAccessRoute(member, '/api/setu/family/search', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/members — GET', () => {
  it('allows family-manager GET /api/setu/members', () => {
    expect(canAccessRoute(manager, '/api/setu/members', 'GET')).toBe(true);
  });
  it('allows family-member GET /api/setu/members', () => {
    expect(canAccessRoute(member, '/api/setu/members', 'GET')).toBe(true);
  });
  it('allows family-manager GET /api/setu/members/FAM001-02', () => {
    expect(canAccessRoute(manager, '/api/setu/members/FAM001-02', 'GET')).toBe(true);
  });
  it('allows family-member GET /api/setu/members/FAM001-02', () => {
    expect(canAccessRoute(member, '/api/setu/members/FAM001-02', 'GET')).toBe(true);
  });
  it('denies legacy family role GET /api/setu/members', () => {
    expect(canAccessRoute(family, '/api/setu/members', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/members/{mid}/profile — family OR welcome-team', () => {
  it('allows the member profile API for any setu family OR welcome-team (admin inherits)', () => {
    expect(canAccessRoute(member, '/api/setu/members/CMT-FAM1-03/profile', 'GET')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/setu/members/CMT-FAM1-03/profile', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/setu/members/CMT-FAM1-03/profile', 'GET')).toBe(true);
  });
  it('still denies welcome-team on a non-profile member GET', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/members/CMT-FAM1-03', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/members — mutations (POST/PATCH/DELETE) manager-only', () => {
  it('allows family-manager POST /api/setu/members', () => {
    expect(canAccessRoute(manager, '/api/setu/members', 'POST')).toBe(true);
  });
  it('denies family-member POST /api/setu/members', () => {
    expect(canAccessRoute(member, '/api/setu/members', 'POST')).toBe(false);
  });
  it('allows family-manager PATCH /api/setu/members/FAM001-02', () => {
    expect(canAccessRoute(manager, '/api/setu/members/FAM001-02', 'PATCH')).toBe(true);
  });
  // Per design §8: PATCH allows self-edit. A family-member can PATCH their own
  // mid; the route handler enforces that `manager` cannot be flipped by a
  // non-manager. PATCHing another member's mid is denied at middleware.
  it('allows family-member PATCH on own mid /api/setu/members/FAM001-02 (self-edit)', () => {
    expect(canAccessRoute(member, '/api/setu/members/FAM001-02', 'PATCH')).toBe(true);
  });
  it('denies family-member PATCH on another member /api/setu/members/FAM001-03', () => {
    expect(canAccessRoute(member, '/api/setu/members/FAM001-03', 'PATCH')).toBe(false);
  });
  it('allows family-manager DELETE /api/setu/members/FAM001-02', () => {
    expect(canAccessRoute(manager, '/api/setu/members/FAM001-02', 'DELETE')).toBe(true);
  });
  it('denies family-member DELETE /api/setu/members/FAM001-02', () => {
    expect(canAccessRoute(member, '/api/setu/members/FAM001-02', 'DELETE')).toBe(false);
  });
  it('denies legacy family POST /api/setu/members', () => {
    expect(canAccessRoute(family, '/api/setu/members', 'POST')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/invite/* — Setu family + welcome-team (catch-all)', () => {
  it('allows family-manager on /api/setu/invite/send', () => {
    expect(canAccessRoute(manager, '/api/setu/invite/send')).toBe(true);
  });
  it('allows welcome-team on /api/setu/invite/send', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/invite/send')).toBe(true);
  });
  it('denies family-member on /api/setu/invite/send (manager-only future endpoint)', () => {
    // The catch-all now only permits manager/welcome-team/admin, not family-member
    expect(canAccessRoute(member, '/api/setu/invite/send')).toBe(false);
  });
  it('denies legacy family on /api/setu/invite/send', () => {
    expect(canAccessRoute(family, '/api/setu/invite/send')).toBe(false);
  });
  it('denies teacher on /api/setu/invite/send', () => {
    expect(canAccessRoute(teacher, '/api/setu/invite/send')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/invite/accept — any signed-in user', () => {
  // The accept route handler enforces verified-contact email match itself,
  // so middleware just needs a session. A fresh-OTP invitee has role='family'
  // (no fid yet) and MUST be allowed through middleware to reach the handler.
  it('allows family-manager on /api/setu/invite/accept', () => {
    expect(canAccessRoute(manager, '/api/setu/invite/accept', 'POST')).toBe(true);
  });
  it('allows family-member on /api/setu/invite/accept', () => {
    expect(canAccessRoute(member, '/api/setu/invite/accept', 'POST')).toBe(true);
  });
  it('allows fresh-OTP family role on /api/setu/invite/accept', () => {
    expect(canAccessRoute(family, '/api/setu/invite/accept', 'POST')).toBe(true);
  });
  it('allows welcome-team on /api/setu/invite/accept', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/invite/accept', 'POST')).toBe(true);
  });
});

describe('canAccessRoute — GET /api/setu/invite/{token} — any signed-in user', () => {
  it('allows family-manager on /api/setu/invite/<token>', () => {
    expect(canAccessRoute(manager, '/api/setu/invite/abc123', 'GET')).toBe(true);
  });
  it('allows fresh-OTP family role on /api/setu/invite/<token>', () => {
    expect(canAccessRoute(family, '/api/setu/invite/abc123', 'GET')).toBe(true);
  });
  it('allows family-member on /api/setu/invite/<token>', () => {
    expect(canAccessRoute(member, '/api/setu/invite/abc123', 'GET')).toBe(true);
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

describe('canAccessRoute — /api/setu/auth/password-sign-in — public', () => {
  it('allows any authenticated role (public route passes before canAccessRoute)', () => {
    expect(canAccessRoute(manager, '/api/setu/auth/password-sign-in', 'POST')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/auth/password-sign-in', 'POST')).toBe(true);
    expect(canAccessRoute(family, '/api/setu/auth/password-sign-in', 'POST')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/setu/auth/password-sign-in', 'POST')).toBe(true);
    expect(canAccessRoute(admin, '/api/setu/auth/password-sign-in', 'POST')).toBe(true);
  });
});

describe('canAccessRoute — /api/setu/auth/set-password — any authenticated Setu user', () => {
  it('allows family-manager', () => {
    expect(canAccessRoute(manager, '/api/setu/auth/set-password', 'POST')).toBe(true);
  });
  it('allows family-member', () => {
    expect(canAccessRoute(member, '/api/setu/auth/set-password', 'POST')).toBe(true);
  });
  it('allows welcome-team', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/auth/set-password', 'POST')).toBe(true);
  });
  it('allows admin', () => {
    expect(canAccessRoute(admin, '/api/setu/auth/set-password', 'POST')).toBe(true);
  });
  it('denies legacy family role (no fid)', () => {
    expect(canAccessRoute(family, '/api/setu/auth/set-password', 'POST')).toBe(false);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/api/setu/auth/set-password', 'POST')).toBe(false);
  });
});

describe('canAccessRoute — /teacher/* pages — teacher capability', () => {
  const parentTeacher: SessionClaims = {
    uid: 'pt',
    role: 'family-manager',
    fid: 'FAM001',
    mid: 'FAM001-01',
    extraRoles: ['teacher'],
  };
  it('allows a teacher-only sevak on /teacher', () => {
    expect(canAccessRoute(teacher, '/teacher')).toBe(true);
    expect(canAccessRoute(teacher, '/teacher/levels/x/attendance')).toBe(true);
  });
  it('allows a parent who is also a teacher (extraRoles)', () => {
    expect(canAccessRoute(parentTeacher, '/teacher')).toBe(true);
  });
  it('allows admin (inherits teacher)', () => {
    expect(canAccessRoute(admin, '/teacher')).toBe(true);
  });
  it('denies a plain family-manager (not a teacher)', () => {
    expect(canAccessRoute(manager, '/teacher')).toBe(false);
  });
  it('denies welcome-team (read views live under /welcome, not /teacher)', () => {
    expect(canAccessRoute(welcomeTeam, '/teacher')).toBe(false);
  });
  it('denies family-member', () => {
    expect(canAccessRoute(member, '/teacher')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/teacher/* — teacher capability', () => {
  it('allows teacher GET /api/setu/teacher/levels', () => {
    expect(canAccessRoute(teacher, '/api/setu/teacher/levels', 'GET')).toBe(true);
  });
  it('allows admin (inherits teacher)', () => {
    expect(canAccessRoute(admin, '/api/setu/teacher/attendance', 'POST')).toBe(true);
  });
  it('denies family-manager (not a teacher) — does NOT fall through to manager catch-all', () => {
    expect(canAccessRoute(manager, '/api/setu/teacher/levels', 'GET')).toBe(false);
    expect(canAccessRoute(manager, '/api/setu/teacher/attendance', 'POST')).toBe(false);
  });
  it('denies welcome-team', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/teacher/levels', 'GET')).toBe(false);
  });
  it('gates /api/setu/teacher/visitors via the teacher catch-all', () => {
    expect(canAccessRoute(teacher, '/api/setu/teacher/visitors', 'POST')).toBe(true);
    expect(canAccessRoute(teacher, '/api/setu/teacher/visitors', 'GET')).toBe(true);
    expect(canAccessRoute(manager, '/api/setu/teacher/visitors', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/admin/teacher-assignments — admin + welcome-team', () => {
  it('allows admin to POST', () => {
    expect(canAccessRoute(admin, '/api/admin/teacher-assignments', 'POST')).toBe(true);
  });
  it('allows welcome-team to POST (front-desk flexibility, RBB-2)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/teacher-assignments', 'POST')).toBe(true);
  });
  it('denies family-manager', () => {
    expect(canAccessRoute(manager, '/api/admin/teacher-assignments', 'POST')).toBe(false);
  });
  it('denies a teacher (assignment is a staff action)', () => {
    expect(canAccessRoute(teacher, '/api/admin/teacher-assignments', 'POST')).toBe(false);
  });
  it('keeps other /api/admin/* admin-only (welcome-team denied on /api/admin/levels)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/levels', 'GET')).toBe(false);
    expect(canAccessRoute(admin, '/api/admin/levels', 'GET')).toBe(true);
  });
});

describe('canAccessRoute — /api/admin/calendar — admin + welcome-team', () => {
  it('allows admin', () => {
    expect(canAccessRoute(admin, '/api/admin/calendar', 'POST')).toBe(true);
    expect(canAccessRoute(admin, '/api/admin/calendar/brampton-2025-09-07', 'PATCH')).toBe(true);
  });
  it('allows welcome-team', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/calendar', 'POST')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/admin/calendar/weekly', 'PUT')).toBe(true);
  });
  it('denies family-manager and teacher', () => {
    expect(canAccessRoute(manager, '/api/admin/calendar', 'POST')).toBe(false);
    expect(canAccessRoute(teacher, '/api/admin/calendar', 'POST')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/calendar — any signed-in user (published, read-only)', () => {
  it('allows family-member to read', () => {
    expect(canAccessRoute(member, '/api/setu/calendar', 'GET')).toBe(true);
  });
  it('allows family-manager, welcome-team, teacher, admin', () => {
    expect(canAccessRoute(manager, '/api/setu/calendar', 'GET')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/setu/calendar', 'GET')).toBe(true);
    expect(canAccessRoute(teacher, '/api/setu/calendar', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/setu/calendar', 'GET')).toBe(true);
  });
});

describe('canAccessRoute — /api/setu/programs — family + welcome-team', () => {
  it('allows family-manager GET /api/setu/programs', () => {
    expect(canAccessRoute(manager, '/api/setu/programs', 'GET')).toBe(true);
  });
  it('allows family-member GET /api/setu/programs', () => {
    expect(canAccessRoute(member, '/api/setu/programs', 'GET')).toBe(true);
  });
  it('allows welcome-team GET /api/setu/programs', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/programs', 'GET')).toBe(true);
  });
  it('denies legacy family role (no fid)', () => {
    expect(canAccessRoute(family, '/api/setu/programs', 'GET')).toBe(false);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/api/setu/programs', 'GET')).toBe(false);
  });
  it('allows family-manager on sub-path /api/setu/programs/bala-vihar', () => {
    expect(canAccessRoute(manager, '/api/setu/programs/bala-vihar', 'GET')).toBe(true);
  });
});

describe('canAccessRoute — /api/setu/volunteering-skills — any setu family (read-only)', () => {
  it('allows family-manager GET', () => {
    expect(canAccessRoute(manager, '/api/setu/volunteering-skills', 'GET')).toBe(true);
  });
  it('allows family-member GET (self-edit needs the option list)', () => {
    expect(canAccessRoute(member, '/api/setu/volunteering-skills', 'GET')).toBe(true);
  });
  it('denies welcome-team (managed via /api/admin/volunteering-skills)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/volunteering-skills', 'GET')).toBe(false);
  });
  it('denies legacy family role (no fid)', () => {
    expect(canAccessRoute(family, '/api/setu/volunteering-skills', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/admin/volunteering-skills — admin-only', () => {
  it('allows admin to PUT', () => {
    expect(canAccessRoute(admin, '/api/admin/volunteering-skills', 'PUT')).toBe(true);
  });
  it('denies welcome-team and family-manager', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/volunteering-skills', 'PUT')).toBe(false);
    expect(canAccessRoute(manager, '/api/admin/volunteering-skills', 'PUT')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/donations', () => {
  it('allows family-manager to POST /api/setu/donations/checkout', () => {
    expect(canAccessRoute(manager, '/api/setu/donations/checkout', 'POST')).toBe(true);
  });
  it('denies family-member POST /api/setu/donations/checkout (manager-only)', () => {
    expect(canAccessRoute(member, '/api/setu/donations/checkout', 'POST')).toBe(false);
  });
  it('allows family-member GET /api/setu/donations (read history)', () => {
    expect(canAccessRoute(member, '/api/setu/donations', 'GET')).toBe(true);
  });
  it('allows family-manager GET /api/setu/donations', () => {
    expect(canAccessRoute(manager, '/api/setu/donations', 'GET')).toBe(true);
  });
  it('denies legacy family role', () => {
    expect(canAccessRoute(family, '/api/setu/donations/checkout', 'POST')).toBe(false);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/api/setu/donations', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/contacts/* (self-service, any family role)', () => {
  it('allows a family-member to POST send-code', () => {
    expect(canAccessRoute(member, '/api/setu/contacts/send-code', 'POST')).toBe(true);
  });
  it('allows a family-member to POST verify-code', () => {
    expect(canAccessRoute(member, '/api/setu/contacts/verify-code', 'POST')).toBe(true);
  });
  it('allows a family-member to POST dismiss-nudge', () => {
    expect(canAccessRoute(member, '/api/setu/contacts/dismiss-nudge', 'POST')).toBe(true);
  });
  it('allows a family-manager too', () => {
    expect(canAccessRoute(manager, '/api/setu/contacts/send-code', 'POST')).toBe(true);
  });
  it('denies a non-family role (welcome-team has no member contacts here)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/contacts/send-code', 'POST')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/seva/* — any setu family', () => {
  it('allows family-manager and family-member', () => {
    expect(canAccessRoute(manager, '/api/setu/seva/opportunities', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/seva/my', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/seva/signups', 'POST')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/seva/signups/o1__FAM001/cancel', 'POST')).toBe(true);
  });
  it('denies welcome-team and legacy family role', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/seva/opportunities', 'GET')).toBe(false);
    expect(canAccessRoute(family, '/api/setu/seva/my', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/welcome/seva/* — welcome-team + admin', () => {
  it('allows welcome-team and admin', () => {
    expect(canAccessRoute(welcomeTeam, '/api/welcome/seva/opportunities', 'POST')).toBe(true);
    expect(canAccessRoute(admin, '/api/welcome/seva/opportunities', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/welcome/seva/opportunities/abc', 'PATCH')).toBe(true);
  });
  it('denies family and teacher', () => {
    expect(canAccessRoute(manager, '/api/welcome/seva/opportunities', 'GET')).toBe(false);
    expect(canAccessRoute(member, '/api/welcome/seva/opportunities', 'POST')).toBe(false);
    expect(canAccessRoute(teacher, '/api/welcome/seva/opportunities', 'GET')).toBe(false);
  });
  it('gates the seva roster + confirm paths to welcome-team (admin inherits)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/welcome/seva/opportunities/o1/signups', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/welcome/seva/signups/o1__FAM/confirm', 'POST')).toBe(true);
    expect(canAccessRoute(member, '/api/welcome/seva/signups/o1__FAM/confirm', 'POST')).toBe(false);
  });
  it('gates the compliance report to welcome-team (admin inherits, family denied)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/welcome/seva/compliance', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/welcome/seva/compliance', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/api/welcome/seva/compliance', 'GET')).toBe(false);
  });
});

describe('canAccessRoute — /api/admin/seva/requirement — admin only', () => {
  it('allows admin, denies welcome-team', () => {
    expect(canAccessRoute(admin, '/api/admin/seva/requirement', 'PUT')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/admin/seva/requirement', 'PUT')).toBe(false);
  });
});

describe('canAccessRoute — /api/setu/teacher/achievements — teacher capability', () => {
  it('allows teacher POST and admin DELETE (inherits teacher); denies family-manager + welcome-team', () => {
    expect(canAccessRoute(teacher, '/api/setu/teacher/achievements', 'POST')).toBe(true);
    expect(canAccessRoute(admin, '/api/setu/teacher/achievements/a1', 'DELETE')).toBe(true);
    expect(canAccessRoute(manager, '/api/setu/teacher/achievements', 'POST')).toBe(false);
    expect(canAccessRoute(welcomeTeam, '/api/setu/teacher/achievements', 'POST')).toBe(false);
  });
});
