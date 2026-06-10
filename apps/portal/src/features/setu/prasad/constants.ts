// Active prasad periods per location. Bump both to the new year's pids when
// school-year:start seeds the next calendar (same cadence as rollover).
export const CURRENT_PRASAD_PIDS = [
  { pid: 'bv-brampton-2025-26', location: 'Brampton' },
  { pid: 'bv-scarborough-2025-26', location: 'Scarborough' },
] as const;

export const MOVE_LOCK_DAYS = 7;

/** Toronto-local YYYY-MM-DD for "today" — all date math is calendar-day based. */
export function torontoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
}

export function daysUntil(ymd: string, todayYmd: string): number {
  const n = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86_400_000; };
  return n(ymd) - n(todayYmd);
}
