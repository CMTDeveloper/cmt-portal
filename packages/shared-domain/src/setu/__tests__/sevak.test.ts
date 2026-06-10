import { describe, it, expect } from 'vitest';
import { SevakRowSchema, GrantRoleBodySchema, RevokeRoleBodySchema } from '../schemas/sevak';

describe('sevak schemas', () => {
  it('accepts a valid SevakRow', () => {
    const row = {
      key: 'CMT-X-01',
      mid: 'CMT-X-01',
      fid: 'CMT-X',
      uid: null,
      name: 'Asha',
      contact: 'a@b.com',
      roles: ['admin'],
      isTeacher: true,
      teacherLevels: ['Level 2 (West)'],
      source: 'family',
    };
    expect(SevakRowSchema.parse(row)).toEqual(row);
  });

  it('rejects an unknown role in the grant body', () => {
    expect(GrantRoleBodySchema.safeParse({ contact: 'a@b.com', role: 'teacher' }).success).toBe(
      false,
    );
    expect(GrantRoleBodySchema.safeParse({ contact: 'a@b.com', role: 'admin' }).success).toBe(true);
  });

  it('revoke body requires contact + grantable role', () => {
    expect(RevokeRoleBodySchema.safeParse({ contact: '', role: 'admin' }).success).toBe(false);
  });
});
