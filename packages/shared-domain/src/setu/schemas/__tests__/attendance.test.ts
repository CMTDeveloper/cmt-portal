import { describe, it, expect } from 'vitest';
import { AddVisitorSchema } from '../attendance';

describe('AddVisitorSchema', () => {
  const base = { levelId: 'L', date: '2026-01-04', firstName: 'Arjun' };

  it('accepts a name-only walk-in (lastName/grade/email/phone all optional)', () => {
    const r = AddVisitorSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({
        firstName: 'Arjun', lastName: '', schoolGrade: null,
        gender: 'PreferNotToSay', parentEmail: null, parentPhone: null,
      });
    }
  });

  it('coerces an empty-string email/grade/phone to null', () => {
    const r = AddVisitorSchema.safeParse({ ...base, parentEmail: '', schoolGrade: '', parentPhone: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ parentEmail: null, schoolGrade: null, parentPhone: null });
  });

  it('rejects a non-email parentEmail and a blank firstName', () => {
    expect(AddVisitorSchema.safeParse({ ...base, parentEmail: 'nope' }).success).toBe(false);
    expect(AddVisitorSchema.safeParse({ ...base, firstName: '   ' }).success).toBe(false);
  });

  it('keeps a valid email + grade', () => {
    const r = AddVisitorSchema.safeParse({ ...base, lastName: 'X', schoolGrade: 'Grade 2', parentEmail: 'p@x.com' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ lastName: 'X', schoolGrade: 'Grade 2', parentEmail: 'p@x.com' });
  });
});
