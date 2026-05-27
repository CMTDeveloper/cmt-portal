/**
 * Toronto-aware date helpers for donation period boundaries.
 *
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, not Toronto-local midnight.
 * These helpers produce the correct UTC timestamps for Toronto start/end of day,
 * handling both EDT (-04:00) and EST (-05:00) automatically via Intl.
 */

const TZ = 'America/Toronto';

/**
 * Returns a Date representing 00:00:00 Toronto local time on the given date string.
 * The date string must be in YYYY-MM-DD format.
 */
export function toTorontoStartOfDay(isoDate: string): Date {
  // Parse as local Toronto midnight by building a datetime in that timezone.
  // Intl.DateTimeFormat resolves the correct UTC offset for the given date
  // (accounts for DST transitions between EDT and EST).
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  // Use a reference point: construct a UTC date and iterate to find the UTC
  // instant whose Toronto wall-clock time is exactly midnight on that date.
  return torontoWallClock(year, month, day, 0, 0, 0);
}

/**
 * Returns a Date representing 23:59:59 Toronto local time on the given date string.
 * The date string must be in YYYY-MM-DD format.
 */
export function toTorontoEndOfDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return torontoWallClock(year, month, day, 23, 59, 59);
}

/**
 * Returns the ISO string for a YYYY-MM-DD input that represents start-of-day
 * in Toronto. Suitable for passing to the donations-period API as startDate.
 */
export function toTorontoStartOfDayISO(isoDate: string): string {
  return toTorontoStartOfDay(isoDate).toISOString();
}

/**
 * Returns the ISO string for a YYYY-MM-DD input that represents end-of-day
 * in Toronto. Suitable for passing to the donations-period API as endDate.
 */
export function toTorontoEndOfDayISO(isoDate: string): string {
  return toTorontoEndOfDay(isoDate).toISOString();
}

/**
 * Given a UTC ISO timestamp (e.g. from Firestore), returns the YYYY-MM-DD
 * string in Toronto local time. Use this to pre-populate `<input type="date">`
 * fields so the displayed date matches the Toronto wall-clock date the user
 * originally picked, not the UTC calendar date.
 *
 * Example: '2026-09-15T03:59:59.000Z' (= 2026-09-14 23:59:59 Toronto EDT)
 * returns '2026-09-14', not '2026-09-15'.
 */
export function isoToTorontoDateInput(iso: string): string {
  const date = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA produces "YYYY-MM-DD" naturally
  return fmt.format(date);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Find the UTC instant whose Toronto wall-clock time is
 * (year, month, day, hour, minute, second). Uses binary-search-free
 * approach: construct a UTC timestamp that's "close" to the answer by
 * assuming a fixed offset, then correct using the actual Intl offset.
 */
function torontoWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  // First approximation: treat the wall-clock time as UTC.
  const approxUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  const approxDate = new Date(approxUTC);

  // Compute the Toronto offset at this approximate UTC instant.
  const offsetMs = getTorontoOffsetMs(approxDate);

  // Shift: UTC instant = wall-clock - offset
  const adjustedDate = new Date(approxUTC - offsetMs);

  // Verify and correct for DST boundary edge cases (offset may differ at
  // the adjusted instant vs the approximate one).
  const offsetMs2 = getTorontoOffsetMs(adjustedDate);
  if (offsetMs2 !== offsetMs) {
    return new Date(approxUTC - offsetMs2);
  }

  return adjustedDate;
}

/** Returns the Toronto UTC offset in milliseconds at a given UTC instant. */
function getTorontoOffsetMs(utcDate: Date): number {
  // Format as Toronto parts, then compute difference from UTC parts.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(utcDate);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

  const tzYear = get('year');
  const tzMonth = get('month');
  const tzDay = get('day');
  const tzHour = get('hour') % 24; // Intl uses 24 for midnight in some locales
  const tzMinute = get('minute');
  const tzSecond = get('second');

  const tzAsUTC = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);
  return tzAsUTC - utcDate.getTime();
}
