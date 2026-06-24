import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import type { ClassCalendarEntryDoc, WeeklyScheduleDoc, Location } from '@cmt/shared-domain';
import { schoolYearDateRange } from '@/features/setu/rollover/school-year';

const ENTRIES = 'classCalendarEntries';
const SCHEDULES = 'weeklySchedules';

type TS = ReturnType<typeof Timestamp.now>;

export type CalendarEntry = Omit<ClassCalendarEntryDoc, 'createdAt' | 'updatedAt'>;

function docToEntry(data: FirebaseFirestore.DocumentData): CalendarEntry {
  return {
    entryId: data.entryId,
    programKey: data.programKey,
    location: data.location,
    date: data.date,
    kind: data.kind,
    classType: data.classType ?? null,
    noClassReason: data.noClassReason ?? null,
    specialEvents: data.specialEvents ?? null,
    enabled: data.enabled,
    prasadNeeded: data.prasadNeeded !== false,
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
  };
}

/** Today's date as YYYY-MM-DD in America/Toronto. */
export function torontoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The most recent Sunday (today if today is Sunday) as a Toronto YYYY-MM-DD. */
export function mostRecentSunday(now: Date = new Date()): string {
  const today = torontoToday(now); // Toronto calendar date
  const d = new Date(`${today}T12:00:00Z`); // noon UTC: weekday is tz-stable
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay 0 = Sunday
  return d.toISOString().slice(0, 10);
}

/**
 * Entries for a (location, program) ordered by date (family/teacher chain;
 * includes drafts). programKey is REQUIRED: families must see only their
 * program's calendar — without it a second usesCalendar program's dates leak in
 * and inflate the attendance denominator. Needs the composite index
 * classCalendarEntries (location, programKey, date).
 */
export async function getCalendar(location: Location, programKey: string): Promise<CalendarEntry[]> {
  const snap = await portalFirestore()
    .collection(ENTRIES)
    .where('location', '==', location)
    .where('programKey', '==', programKey)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map((d) => docToEntry(d.data()));
}

/**
 * Published (enabled) entries only — family/teacher view, per program, scoped to
 * the LIVE school year. `liveYear` is REQUIRED so every family/teacher caller is
 * compiler-forced to pass it (an unscoped path is the bug this guards against).
 *
 * The filter is the live year's FULL window `[start, end]` (Aug 1 → Jul 31), not
 * just a lower bound: a pure lower bound hides prior-year Sundays but NOT the
 * next-year (preparing) Sundays cloned for the upcoming year — those are
 * `enabled:true` and have dates AFTER the live year's start, so only the upper
 * bound hides them until an admin Activates the new year.
 */
export async function getPublishedCalendar(
  location: Location,
  programKey: string,
  liveYear: string,
): Promise<CalendarEntry[]> {
  const entries = await getCalendar(location, programKey);
  const { start, end } = schoolYearDateRange(liveYear);
  return entries.filter((e) => e.enabled && e.date >= start && e.date <= end);
}

export interface UpcomingSummary {
  nextClass: CalendarEntry | null; // next enabled class-kind entry on/after today
  upcoming: CalendarEntry[]; // next few enabled entries (class + no-class notices) on/after today
}

/** Drives the dashboard "Upcoming" card (scoped to one program). */
export async function getUpcoming(
  location: Location,
  programKey: string,
  liveYear: string,
  todayYmd: string = torontoToday(),
  limit = 4,
): Promise<UpcomingSummary> {
  const entries = await getPublishedCalendar(location, programKey, liveYear);
  const future = entries.filter((e) => e.date >= todayYmd);
  const nextClass = future.find((e) => e.kind === 'class') ?? null;
  return { nextClass, upcoming: future.slice(0, limit) };
}

/** Published class-kind dates on/before today (Toronto), ascending — the
 * Sundays the given program has actually held so far. The denominator for
 * attendance, so it MUST be program-scoped (else a second program's Sundays
 * inflate it). */
export async function getClassDatesHeld(
  location: Location,
  programKey: string,
  liveYear: string,
  todayYmd: string = torontoToday(),
): Promise<string[]> {
  const entries = await getPublishedCalendar(location, programKey, liveYear);
  return entries
    .filter((e) => e.kind === 'class' && e.date <= todayYmd)
    .map((e) => e.date)
    .sort();
}

export async function getWeeklySchedule(location: Location): Promise<WeeklyScheduleDoc['rows']> {
  const snap = await portalFirestore().collection(SCHEDULES).doc(location).get();
  if (!snap.exists) return [];
  const data = snap.data() as { rows?: WeeklyScheduleDoc['rows'] } | undefined;
  return data?.rows ?? [];
}

/** Used by the admin GET route — serializes audit timestamps too. */
export async function getCalendarSerialized(location: Location): Promise<
  Array<CalendarEntry & { createdAt: string; updatedAt: string }>
> {
  const snap = await portalFirestore()
    .collection(ENTRIES)
    .where('location', '==', location)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      ...docToEntry(data),
      createdAt: (data.createdAt as TS).toDate().toISOString(),
      updatedAt: (data.updatedAt as TS).toDate().toISOString(),
    };
  });
}
