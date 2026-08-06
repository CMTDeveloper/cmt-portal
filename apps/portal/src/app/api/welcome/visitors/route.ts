import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWelcomeTeam, GuestCheckInSchema, GuestUpdateSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { recordGuestCheckIn, updateGuestChild } from '@/features/check-in/shared';
import type { PortalSessionHeaders } from '@/lib/auth/headers';

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

/**
 * Gate 3 of three, shared by every method on this route.
 *
 * Middleware carries the same rule, but `canAccessRoute`'s clause for this path
 * is METHOD-BLIND: it grants `/api/welcome/visitors` and everything under it to
 * welcome-team regardless of verb. So a new method added to this file inherits
 * middleware's yes automatically and would ship with no gate of its own unless
 * the check lives somewhere every handler must pass through. Returns a Response
 * to send, or the session when the caller may proceed.
 */
function requireWelcomeTeam(req: Request): NextResponse | PortalSessionHeaders {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return session;
}

export async function POST(req: Request) {
  const gate = requireWelcomeTeam(req);
  if (gate instanceof NextResponse) return gate;

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

/**
 * Correct one child of a visit already on the board, plus the visit's contact.
 *
 * The half that matters. A guest child's `grade` is the ONLY thing that routes
 * them to a teacher - `guestMatchesLevel` compares it to each level's gradeBand
 * - so a wrong or missing grade means no teacher ever sees that child. That is
 * exactly what the "Not matched to a class" bucket on /welcome/visitors is full
 * of, and until now the desk could see the problem and not fix it.
 *
 * Only PORTAL guest documents are addressable here. The board also shows rows
 * from the legacy standalone door app, which live in a different Firebase
 * project and whose kiosk shut down 2026-08-03; those carry `editRef: null` and
 * the UI offers them no control.
 *
 * ── What a correction does NOT reach back and change ────────────────────────
 * If a teacher has ALREADY confirmed this guest (`addVisitorOnPrompt` creates a
 * pending family and marks attendance), that record stands:
 *   - a corrected GRADE moves the guest onto the new level's visitor list as
 *     unconfirmed, while the old level keeps its attendance mark. That mark is
 *     history - the child really was in that room that morning - so rewriting it
 *     would be falsifying the register, not fixing it.
 *   - a corrected EMAIL changes the key `getLevelVisitorsView` hashes into
 *     `contactKeys`, so the teacher's "already confirmed" flag can flip back to
 *     false. Display only; the attendance record is untouched.
 * Both are deliberate and neither loses data. Revisit only if the desk reports
 * being confused by it.
 */
export async function PATCH(req: Request) {
  const gate = requireWelcomeTeam(req);
  if (gate instanceof NextResponse) return gate;

  const raw = await req.json().catch(() => null);
  const parsed = GuestUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const { id, childIndex, expected, child, contact } = parsed.data;
  const result = await updateGuestChild({
    docId: id,
    childIndex,
    expected,
    child,
    contact,
    editedByUid: gate.uid,
  });

  if (!result.ok) {
    // Distinct codes, not one generic failure: each means something different
    // for the person at the desk to do next, and the form's copy branches on the
    // reason rather than on the status.
    //
    // 409 covers all three survivors, for one shared reason - the request was
    // well-formed and authorized, and the CONFLICT is with the document's
    // current state. They are not all races, though. Only `changed` is one;
    // `no-children` and `index-out-of-range` are permanent for that document, so
    // an identical retry fails identically. FAILURE_COPY draws that line: two of
    // them say refresh, and `no-children` says there is nothing to correct at
    // all, because for a pre-`children[]` record that is the truth.
    const status = result.reason === 'not-found' ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
