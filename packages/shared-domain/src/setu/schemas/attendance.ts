import { z } from 'zod';

// Teacher taps one of these. An enrolled-and-matched member with NO event for a
// class date is `unaccounted` — derived (never stored), drives the "who's
// unmarked" view. Setu-prefixed to avoid colliding with the legacy check-in
// AttendanceStatus (which also has 'uninformed').
export const SETU_ATTENDANCE_STATUSES = ['present', 'absent', 'late'] as const;
export type SetuAttendanceStatus = (typeof SETU_ATTENDANCE_STATUSES)[number];

export type RosterStatus = SetuAttendanceStatus | 'unaccounted';

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/** Composite id → one row per student per class-day; re-marking overwrites. */
export function attendanceAid(levelId: string, mid: string, date: string): string {
  return `${levelId}-${mid}-${date}`;
}

export const AttendanceEventDocSchema = z.object({
  aid: z.string().min(1),
  levelId: z.string().min(1),
  mid: z.string().min(1),
  fid: z.string().min(1),
  pid: z.string().min(1),
  date: YMD,
  status: z.enum(SETU_ATTENDANCE_STATUSES),
  isGuest: z.boolean(),
  markedByUid: z.string().min(1),
  markedByMid: z.string().nullable(),
  markedAt: z.date(),
  updatedAt: z.date(),
});

export type AttendanceEventDoc = z.infer<typeof AttendanceEventDocSchema>;

// POST /api/setu/teacher/attendance body: a batch of marks for one level+date.
export const SaveAttendanceSchema = z.object({
  levelId: z.string().min(1),
  date: YMD,
  marks: z.record(z.string().min(1), z.enum(SETU_ATTENDANCE_STATUSES)),
});

export type SaveAttendanceInput = z.infer<typeof SaveAttendanceSchema>;

// POST /api/setu/teacher/guests — mark one visiting student present at a level.
export const MarkGuestSchema = z.object({
  levelId: z.string().min(1),
  date: YMD,
  mid: z.string().min(1),
  status: z.enum(SETU_ATTENDANCE_STATUSES).default('present'),
});

export type MarkGuestInput = z.infer<typeof MarkGuestSchema>;

// POST /api/setu/teacher/add-student — a teacher adds an unregistered child on
// the spot. Creates/continues a Setu family keyed by the parent's email
// (contactKey claim), marks the child present as a guest, auto-enrolls.
export const AddStudentSchema = z.object({
  levelId: z.string().min(1),
  date: YMD,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  schoolGrade: z.string().nullable().default(null),
  gender: z.enum(['Male', 'Female', 'PreferNotToSay']).default('PreferNotToSay'),
  parentEmail: z.string().email(),
  parentPhone: z.string().nullable().default(null),
});

export type AddStudentInput = z.infer<typeof AddStudentSchema>;
