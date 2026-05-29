import { z } from 'zod';
import { PROGRAM_KEYS, LOCATIONS } from './donation-period';
import { toSafeSlug } from '../../utils/slug';

// The managed school-year calendar that replaces the per-location PDF. One
// entry per (location, class-Sunday). Admin + welcome-team publish; families
// see published (enabled) entries on their dashboard + /family/calendar.
export const CLASS_TYPES = ['regular', 'first', 'short'] as const;
export type ClassType = (typeof CLASS_TYPES)[number];

export const CALENDAR_KINDS = ['class', 'no-class'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/** Deterministic entry id: `{location}-{YYYY-MM-DD}`. */
export function calendarEntryId(location: string, date: string): string {
  return `${toSafeSlug(location)}-${date}`;
}

export const ClassCalendarEntryDocSchema = z.object({
  entryId: z.string().min(1),
  programKey: z.enum(PROGRAM_KEYS),
  location: z.enum(LOCATIONS),
  date: YMD,
  kind: z.enum(CALENDAR_KINDS),
  classType: z.enum(CLASS_TYPES).nullable(),
  noClassReason: z.string().nullable(),
  specialEvents: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.date(),
  createdBy: z.string().min(1),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});

export type ClassCalendarEntryDoc = z.infer<typeof ClassCalendarEntryDocSchema>;

// kind=class → classType required, noClassReason must be null.
// kind=no-class → classType must be null, noClassReason optional.
function kindConsistent(d: {
  kind: CalendarKind;
  classType: ClassType | null | undefined;
  noClassReason: string | null | undefined;
}): boolean {
  if (d.kind === 'class') return d.classType != null && (d.noClassReason == null || d.noClassReason === '');
  return d.classType == null;
}

export const CreateCalendarEntrySchema = z
  .object({
    programKey: z.enum(PROGRAM_KEYS).default('bala-vihar'),
    location: z.enum(LOCATIONS),
    date: YMD,
    kind: z.enum(CALENDAR_KINDS),
    classType: z.enum(CLASS_TYPES).nullable().default(null),
    noClassReason: z.string().nullable().default(null),
    specialEvents: z.string().nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .refine(kindConsistent, {
    message: 'class entries need a classType (and no noClassReason); no-class entries must omit classType',
    path: ['kind'],
  });

export type CreateCalendarEntryInput = z.infer<typeof CreateCalendarEntrySchema>;

export const UpdateCalendarEntrySchema = z
  .object({
    kind: z.enum(CALENDAR_KINDS).optional(),
    classType: z.enum(CLASS_TYPES).nullable().optional(),
    noClassReason: z.string().nullable().optional(),
    specialEvents: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (d) => {
      // Only enforce when kind is present in the patch; the route reconciles
      // partials against the existing doc.
      if (d.kind) return kindConsistent({ kind: d.kind, classType: d.classType, noClassReason: d.noClassReason });
      return true;
    },
    { message: 'class entries need a classType; no-class entries must omit classType', path: ['kind'] },
  );

export type UpdateCalendarEntryInput = z.infer<typeof UpdateCalendarEntrySchema>;

// weeklySchedules/{location} — the fixed per-location time header.
const ScheduleRowSchema = z.object({ time: z.string().min(1), label: z.string().min(1) });

export const WeeklyScheduleDocSchema = z.object({
  location: z.enum(LOCATIONS),
  rows: z.array(ScheduleRowSchema),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});

export type WeeklyScheduleDoc = z.infer<typeof WeeklyScheduleDocSchema>;

export const SetWeeklyScheduleSchema = z.object({
  location: z.enum(LOCATIONS),
  rows: z.array(ScheduleRowSchema),
});

export type SetWeeklyScheduleInput = z.infer<typeof SetWeeklyScheduleSchema>;
