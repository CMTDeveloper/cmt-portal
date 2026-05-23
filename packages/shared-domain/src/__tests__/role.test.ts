import { describe, it, expect } from 'vitest';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isSetuManager, isWelcomeTeam, ROLES } from '../auth/role';

describe('ROLES', () => {
  it('includes all known roles', () => {
    expect(ROLES).toContain('admin');
    expect(ROLES).toContain('teacher');
    expect(ROLES).toContain('family');
    expect(ROLES).toContain('family-manager');
    expect(ROLES).toContain('family-member');
    expect(ROLES).toContain('welcome-team');
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
  it('returns false for admin', () => {
    expect(isWelcomeTeam({ role: 'admin' })).toBe(false);
  });
});
