import { describe, it, expect } from 'vitest';
import { isAdmin, isTeacher, isFamily, ROLES } from '../auth/role';

describe('ROLES', () => {
  it('lists the three known roles', () => {
    expect(ROLES).toEqual(['admin', 'teacher', 'family']);
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
