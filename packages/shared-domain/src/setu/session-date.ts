/**
 * The Sunday that starts the week containing `ymd`, as a Toronto YYYY-MM-DD.
 * Returns `ymd` unchanged when it is already a Sunday.
 *
 * Bala Vihar runs on Sundays, so every teacher-facing surface keys its data to
 * "the Sunday of this week". Anything stamped with the raw calendar day is
 * invisible to those surfaces unless it is normalized through here first.
 *
 * The noon-UTC anchor is load-bearing, not defensive. `new Date('2026-09-06')`
 * is UTC midnight, which is 8pm Saturday the 5th in Toronto; formatting that as
 * a Toronto calendar day yields '2026-09-05', and the Sunday then lands a full
 * WEEK early ('2026-08-30'). Noon UTC is the same calendar day in every North
 * American zone, so the weekday is stable. A test pins this.
 *
 * Lives in shared-domain rather than beside the portal's calendar helpers for
 * two reasons: `features/check-in` needs it and must not import from
 * `features/setu` (CLAUDE.md discipline 1), and it is pure date math the mobile
 * app can consume as-is.
 */
export function sessionDateFor(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay 0 = Sunday
  return d.toISOString().slice(0, 10);
}
