import { describe, it, expect } from 'vitest';
import {
  TeacherDocSchema,
  TeacherAssignmentDocSchema,
  AssignTeacherSchema,
} from '../schemas/teacher';

describe('TeacherDocSchema', () => {
  const valid = {
    tid: 'TCH-ABC123',
    firstName: 'Asha',
    lastName: 'Iyer',
    email: 'asha@example.com',
    phone: null,
    createdAt: new Date(),
    createdByUid: 'uid-admin',
  };

  it('accepts a valid teacher doc', () => {
    expect(TeacherDocSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null email + phone', () => {
    expect(TeacherDocSchema.safeParse({ ...valid, email: null, phone: null }).success).toBe(true);
  });

  it('rejects an empty firstName', () => {
    expect(TeacherDocSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false);
  });
});

describe('TeacherAssignmentDocSchema', () => {
  it('accepts a valid assignment', () => {
    expect(
      TeacherAssignmentDocSchema.safeParse({
        ref: 'CMT-AAAA1111-01',
        levelIds: ['brampton-level-2-bv-brampton-2025-26'],
        updatedAt: new Date(),
        updatedByUid: 'uid-admin',
      }).success,
    ).toBe(true);
  });

  it('accepts an empty levelIds (teacher unassigned from all levels)', () => {
    expect(
      TeacherAssignmentDocSchema.safeParse({
        ref: 'CMT-AAAA1111-01',
        levelIds: [],
        updatedAt: new Date(),
        updatedByUid: 'uid-admin',
      }).success,
    ).toBe(true);
  });
});

describe('AssignTeacherSchema', () => {
  it('accepts a valid assign payload', () => {
    expect(
      AssignTeacherSchema.safeParse({ ref: 'CMT-AAAA1111-01', levelIds: ['l1', 'l2'] }).success,
    ).toBe(true);
  });

  it('accepts clearing all levels (empty array)', () => {
    expect(AssignTeacherSchema.safeParse({ ref: 'CMT-AAAA1111-01', levelIds: [] }).success).toBe(true);
  });

  it('accepts a teacher email instead of a ref', () => {
    expect(AssignTeacherSchema.safeParse({ teacherEmail: 'teacher@example.com', levelIds: ['l1'] }).success).toBe(true);
  });

  it('rejects an empty ref', () => {
    expect(AssignTeacherSchema.safeParse({ ref: '', levelIds: ['l1'] }).success).toBe(false);
  });

  it('rejects a payload without ref or teacherEmail', () => {
    expect(AssignTeacherSchema.safeParse({ levelIds: ['l1'] }).success).toBe(false);
  });

  it('rejects an empty-string levelId', () => {
    expect(AssignTeacherSchema.safeParse({ ref: 'r', levelIds: [''] }).success).toBe(false);
  });
});
