import { z } from 'zod';
import { GRADE_LADDER } from './grade-ladder';

// Grade is restricted to the canonical promotion ladder so a set value always
// resolves on the next rollover preview (no free-text "Grade 4" that needs
// normalizing). Shishu (age-based, no grade) is out of scope for this control.
export const SetMemberGradeBodySchema = z.object({
  fid: z.string().min(1),
  mid: z.string().min(1),
  schoolGrade: z.enum(GRADE_LADDER),
});
export type SetMemberGradeBody = z.infer<typeof SetMemberGradeBodySchema>;
