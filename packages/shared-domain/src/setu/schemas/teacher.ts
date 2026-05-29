import { z } from 'zod';

// A teacher-only sevak (no family). A sevak who is also a parent uses their
// existing member `mid` and needs no teachers/ doc — the teacher capability
// attaches to their member via a teacherAssignment keyed by that mid.
export const TeacherDocSchema = z.object({
  tid: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.date(),
  createdByUid: z.string().min(1),
});

export type TeacherDoc = z.infer<typeof TeacherDocSchema>;

// teacherAssignments/{ref} — ref = member mid (parent-teachers) OR standalone tid.
// Mirrors roleAssignments/{mid}; assigning grants the `teacher` capability to
// that person's session (computed at session-build time from this doc).
export const TeacherAssignmentDocSchema = z.object({
  ref: z.string().min(1),
  levelIds: z.array(z.string()),
  updatedAt: z.date(),
  updatedByUid: z.string().min(1),
});

export type TeacherAssignmentDoc = z.infer<typeof TeacherAssignmentDocSchema>;

// POST body for /api/admin/teacher-assignments — set the levels a teacher covers.
export const AssignTeacherSchema = z.object({
  ref: z.string().min(1),
  levelIds: z.array(z.string().min(1)),
});

export type AssignTeacherInput = z.infer<typeof AssignTeacherSchema>;
