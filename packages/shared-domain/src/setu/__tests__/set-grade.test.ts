import { describe, it, expect } from 'vitest';
import { SetMemberGradeBodySchema } from '../set-grade';

describe('SetMemberGradeBodySchema', () => {
  it('accepts a fid/mid + a ladder grade', () => {
    const p = SetMemberGradeBodySchema.parse({ fid: 'CMT-X', mid: 'CMT-X-01', schoolGrade: '4' });
    expect(p.schoolGrade).toBe('4');
  });
  it('rejects an off-ladder grade and a missing fid', () => {
    expect(SetMemberGradeBodySchema.safeParse({ fid: 'CMT-X', mid: 'm', schoolGrade: 'Grade 4' }).success).toBe(false);
    expect(SetMemberGradeBodySchema.safeParse({ fid: 'CMT-X', mid: 'm', schoolGrade: '13' }).success).toBe(false);
    expect(SetMemberGradeBodySchema.safeParse({ mid: 'm', schoolGrade: '4' }).success).toBe(false);
  });
  it('accepts JK and SK', () => {
    expect(SetMemberGradeBodySchema.safeParse({ fid: 'f', mid: 'm', schoolGrade: 'JK' }).success).toBe(true);
  });
});
