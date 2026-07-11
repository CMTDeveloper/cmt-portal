import { describe, it, expect } from 'vitest';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isSetuManager, isWelcomeTeam, isKiosk, ROLES } from '../auth/role';

describe('ROLES', () => {
  it('includes all known roles', () => {
    expect(ROLES).toContain('admin');
    expect(ROLES).toContain('teacher');
    expect(ROLES).toContain('family');
    expect(ROLES).toContain('family-manager');
    expect(ROLES).toContain('family-member');
    expect(ROLES).toContain('welcome-team');
    expect(ROLES).toContain('kiosk');
  });
});

describe('isAdmin', () => {
  it('returns true for admin', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('returns false for teacher', () => {
    expect(isAdmin({ role: 'teacher' })).toBe(false);
  });
  it('returns false for family', () => {
    expect(isAdmin({ role: 'family' })).toBe(false);
  });
  it('returns false for undefined role', () => {
    expect(isAdmin({})).toBe(false);
  });
});

describe('isTeacher', () => {
  it('returns true for teacher', () => {
    expect(isTeacher({ role: 'teacher' })).toBe(true);
  });
  it('returns true for admin (inherits teacher)', () => {
    expect(isTeacher({ role: 'admin' })).toBe(true);
  });
  it('returns false for family', () => {
    expect(isTeacher({ role: 'family' })).toBe(false);
  });
});

describe('isFamily', () => {
  it('returns true for family', () => {
    expect(isFamily({ role: 'family' })).toBe(true);
  });
  it('returns false for admin', () => {
    expect(isFamily({ role: 'admin' })).toBe(false);
  });
});

describe('isSetuFamily', () => {
  it('returns true for family-manager', () => {
    expect(isSetuFamily({ role: 'family-manager' })).toBe(true);
  });
  it('returns true for family-member', () => {
    expect(isSetuFamily({ role: 'family-member' })).toBe(true);
  });
  it('returns false for legacy family role', () => {
    expect(isSetuFamily({ role: 'family' })).toBe(false);
  });
  it('returns false for admin', () => {
    expect(isSetuFamily({ role: 'admin' })).toBe(false);
  });
});

describe('isSetuManager', () => {
  it('returns true for family-manager', () => {
    expect(isSetuManager({ role: 'family-manager' })).toBe(true);
  });
  it('returns false for family-member', () => {
    expect(isSetuManager({ role: 'family-member' })).toBe(false);
  });
});

describe('isWelcomeTeam', () => {
  it('returns true for welcome-team', () => {
    expect(isWelcomeTeam({ role: 'welcome-team' })).toBe(true);
  });
  it('returns true for admin (admin inherits welcome-team capability)', () => {
    expect(isWelcomeTeam({ role: 'admin' })).toBe(true);
  });
  it('returns false for family-manager without welcome-team in extras', () => {
    expect(isWelcomeTeam({ role: 'family-manager' })).toBe(false);
  });
});

describe('isKiosk', () => {
  it('is true for the kiosk role and for admin', () => {
    expect(isKiosk({ role: 'kiosk' })).toBe(true);
    expect(isKiosk({ role: 'admin' })).toBe(true);
    expect(isKiosk({ role: 'welcome-team' })).toBe(false);
    expect(isKiosk({ role: 'family-manager' })).toBe(false);
  });
  it('is true when kiosk is in extraRoles', () => {
    expect(isKiosk({ role: 'family-manager', extraRoles: ['kiosk'] })).toBe(true);
  });
});

describe('multi-role via extraRoles', () => {
  it('isAdmin: true when admin is in extraRoles', () => {
    expect(isAdmin({ role: 'family-manager', extraRoles: ['admin'] })).toBe(true);
  });
  it('isWelcomeTeam: true when welcome-team is in extraRoles', () => {
    expect(isWelcomeTeam({ role: 'family-manager', extraRoles: ['welcome-team'] })).toBe(true);
  });
  it('isSetuFamily: still true even with admin extra', () => {
    expect(isSetuFamily({ role: 'family-manager', extraRoles: ['admin'] })).toBe(true);
  });
  it('isAdmin: false when extraRoles is empty', () => {
    expect(isAdmin({ role: 'family-manager', extraRoles: [] })).toBe(false);
  });
  it('isAdmin: false when only welcome-team is in extraRoles', () => {
    expect(isAdmin({ role: 'family-manager', extraRoles: ['welcome-team'] })).toBe(false);
  });
});
