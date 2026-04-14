import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import type { SessionClaims } from '../auth/session';

const admin: SessionClaims = { uid: 'a', role: 'admin' };
const teacher: SessionClaims = { uid: 't', role: 'teacher' };
const family: SessionClaims = { uid: 'f', role: 'family', familyId: '42' };

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
