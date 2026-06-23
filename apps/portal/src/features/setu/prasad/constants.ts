// Fallback prasad periods per location when app-managed school-year config or
// offerings are not available yet.
export const FALLBACK_PRASAD_PERIODS = [
  { pid: 'bv-brampton-2025-26', location: 'Brampton' },
  { pid: 'bv-scarborough-2025-26', location: 'Scarborough' },
] as const;

export const MOVE_LOCK_DAYS = 7;

/** Cap fallback when prasadConfig/{pid} is missing (assignments seeded without a publish). */
export const FALLBACK_CAP = 10;

/** Toronto-local YYYY-MM-DD for "today" — all date math is calendar-day based. */
export function torontoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
}

export function daysUntil(ymd: string, todayYmd: string): number {
  const n = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86_400_000; };
  return n(ymd) - n(todayYmd);
}

/** "2026-03-22" → "Sun, Mar 22" (UTC-pinned — never local-TZ-shifts the calendar day). */
export function formatPrasadDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
