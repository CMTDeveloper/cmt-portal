import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWelcomeTeam, GuestCheckInSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { recordGuestCheckIn } from '@/features/check-in/shared';

/**
 * Front-desk visitor capture.
 *
 * Vaibhav, 2026-08-05: *"Visitor management - add/update"*. The door kiosk has
 * always been able to record a guest; the desk could only LOOK at the board.
 *
 * It writes the same `guest_check_ins` document the kiosk writes, through the
 * same `recordGuestCheckIn`, so a desk-recorded visitor appears on
 * /welcome/visitors and on the matching teacher's screen with no second code
 * path to keep in step. The validation schema is shared for the same reason
 * (`GuestCheckInSchema` in shared-domain).
 *
 * NOT the teacher's confirm flow. `addVisitorOnPrompt` creates a pending FAMILY
 * and marks attendance - that is the teacher deciding a visitor is in their
 * class, and it stays theirs. This only records that someone came.
 *
 * Legacy `guest-families` is never touched: it lives in the shared
 * check-in-source project, and the legacy kiosk that wrote it shut down
 * 2026-08-03. Those rows are history, and history is read-only.
 */

/**
 * How far either side of today a walk-in may be recorded.
 *
 * Format alone is not enough: `2099-01-03` and `1970-01-04` are both
 * well-formed Sundays, and both would be written verbatim as `date` AND as the
 * derived `sessionDate`, quietly polluting attendance history and the reports
 * built on it. Nothing else validates this - `recordGuestCheckIn` trusts what
 * it is handed, and the UI's native date input has no min/max.
 *
 * The window is deliberately generous rather than "today only": the desk
 * legitimately catches up on the Sunday just gone, and a Monday-morning
 * correction is normal. It is a sanity bound, not a policy.
 */
const MAX_BACKDATE_DAYS = 90;
const MAX_FUTUREDATE_DAYS = 7;

function withinRecordingWindow(ymd: string): boolean {
  const day = Date.parse(`${ymd}T12:00:00Z`);
  if (Number.isNaN(day)) return false;
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const days = (day - today) / 86_400_000;
  return days >= -MAX_BACKDATE_DAYS && days <= MAX_FUTUREDATE_DAYS;
}

const bodySchema = GuestCheckInSchema.extend({
  // The Sunday the desk is looking at. Optional; absent means today, which is
  // what the kiosk does. Validated for shape AND range - a malformed or absurd
  // value must never reach the sessionDate normalization.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(withinRecordingWindow, {
      message: `date must be within ${MAX_BACKDATE_DAYS} days back and ${MAX_FUTUREDATE_DAYS} days ahead`,
    })
    .optional(),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  // Gate 3 of three. Middleware carries the same rule; this is here so the
  // route is not one canAccessRoute edit away from being open, which is the
  // lesson `participation` taught when two screens declined to offer a control
  // and the route accepted it anyway.
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const { date, notes, ...rest } = parsed.data;
  // `notes` is spread in only when present. Under exactOptionalPropertyTypes an
  // optional property may not be assigned `undefined`, and zod's `.optional()`
  // produces exactly that when the field is absent - so the key is omitted
  // rather than set to undefined.
  const guest = { ...rest, ...(notes !== undefined ? { notes } : {}) };
  const id = await recordGuestCheckIn(guest, date);

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
