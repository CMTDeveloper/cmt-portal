import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import type { ClassCalendarEntryDoc, WeeklyScheduleDoc, Location } from '@cmt/shared-domain';

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

/** All entries for a location ordered by date (admin view — includes drafts). */
export async function getCalendar(location: Location): Promise<CalendarEntry[]> {
  const snap = await portalFirestore()
    .collection(ENTRIES)
    .where('location', '==', location)
    .orderBy('date', 'asc')
    .get();
  return snap.docs.map((d) => docToEntry(d.data()));
}

/** Published (enabled) entries only — family/teacher view. */
export async function getPublishedCalendar(location: Location): Promise<CalendarEntry[]> {
  const entries = await getCalendar(location);
  return entries.filter((e) => e.enabled);
}

export interface UpcomingSummary {
  nextClass: CalendarEntry | null; // next enabled class-kind entry on/after today
  upcoming: CalendarEntry[]; // next few enabled entries (class + no-class notices) on/after today
}

/** Drives the dashboard "Upcoming" card. */
export async function getUpcoming(
  location: Location,
  todayYmd: string = torontoToday(),
  limit = 4,
): Promise<UpcomingSummary> {
  const entries = await getPublishedCalendar(location);
  const future = entries.filter((e) => e.date >= todayYmd);
  const nextClass = future.find((e) => e.kind === 'class') ?? null;
  return { nextClass, upcoming: future.slice(0, limit) };
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
