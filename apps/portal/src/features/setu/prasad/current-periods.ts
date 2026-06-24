import { BALA_VIHAR, type Location } from '@cmt/shared-domain';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { balaViharSourceOidsForYear, schoolYearOfPid } from '@/features/setu/rollover/school-year';

type Db = FirebaseFirestore.Firestore;

const PRASAD_LOCATION_ORDER: Location[] = ['Brampton', 'Scarborough'];

export interface PrasadPeriodOption {
  pid: string;
  location: Location;
}

function isPrasadLocation(value: unknown): value is Location {
  return PRASAD_LOCATION_ORDER.includes(value as Location);
}

export function fallbackPrasadPeriodsForYear(year: string): PrasadPeriodOption[] {
  const periods: PrasadPeriodOption[] = [];
  for (const pid of balaViharSourceOidsForYear(year)) {
    if (pid.includes('-brampton-')) periods.push({ pid, location: 'Brampton' });
    if (pid.includes('-scarborough-')) periods.push({ pid, location: 'Scarborough' });
  }
  return periods;
}

function sortPrasadPeriods(periods: PrasadPeriodOption[]): PrasadPeriodOption[] {
  const order = new Map(PRASAD_LOCATION_ORDER.map((location, index) => [location, index]));
  return [...periods].sort((a, b) =>
    (order.get(a.location) ?? 99) - (order.get(b.location) ?? 99)
    || a.pid.localeCompare(b.pid),
  );
}

export async function getPrasadPeriodsForYear(db: Db, year: string): Promise<PrasadPeriodOption[]> {
  const snap = await db
    .collection('offerings')
    .where('programKey', '==', BALA_VIHAR)
    .where('termLabel', '==', year)
    .get();

  const periods = snap.docs.flatMap((doc) => {
    const data = doc.data() as { oid?: unknown; location?: unknown };
    if (typeof data.oid !== 'string' || data.oid.length === 0) return [];
    if (!isPrasadLocation(data.location)) return [];
    return [{ pid: data.oid, location: data.location }];
  });

  return periods.length > 0
    ? sortPrasadPeriods(periods)
    : fallbackPrasadPeriodsForYear(year);
}

export async function getCurrentPrasadPeriods(db: Db): Promise<PrasadPeriodOption[]> {
  const { currentYear } = await getSchoolYearConfig(db);
  return getPrasadPeriodsForYear(db, currentYear);
}

export async function findCurrentPrasadPeriod(db: Db, pid: string): Promise<PrasadPeriodOption | null> {
  return (await getCurrentPrasadPeriods(db)).find((period) => period.pid === pid) ?? null;
}

/** Resolve a prasad period for the pid's OWN school year (not the live year) —
 *  so preparing/past-year pids resolve. Returns null if absent. */
export async function findPrasadPeriodForPid(db: Db, pid: string): Promise<PrasadPeriodOption | null> {
  return (await getPrasadPeriodsForYear(db, schoolYearOfPid(pid))).find((p) => p.pid === pid) ?? null;
}
