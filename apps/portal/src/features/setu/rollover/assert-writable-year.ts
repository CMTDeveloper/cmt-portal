import { getSchoolYearConfig } from './school-year-config';

type Db = FirebaseFirestore.Firestore;

export class PastYearWriteError extends Error {
  constructor(
    public year: string,
    public liveYear: string,
  ) {
    super('past-year');
    this.name = 'PastYearWriteError';
  }
}

/**
 * Throw {@link PastYearWriteError} when `year` is in the PAST (`year < live`).
 * The LIVE year AND any PREPARING (future) year are writable — preparing-year
 * writes are the whole point of the prep workflow (set up next year's
 * levels/calendar/prasad before Activate). Only past years are read-only
 * history. School-year strings are `YYYY-YY`, so a lexical `<` equals
 * chronological order (the same comparison `resolveViewYear` uses).
 */
export async function assertWritableYear(db: Db, year: string): Promise<void> {
  const { currentYear } = await getSchoolYearConfig(db);
  if (year < currentYear) throw new PastYearWriteError(year, currentYear);
}
