import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import { resolveKioskFamilyOrMigrate } from '@/features/setu/check-in/resolve-kiosk-family';
import {
  autoEnrollBalaVihar,
  type AutoEnrollResult,
} from '@/features/setu/check-in/auto-enroll-bala-vihar';
import { markDoorAttendance } from '@/features/setu/check-in/mark-door-attendance';
import { notifyUnpaidAtDoor } from '@/features/setu/check-in/notify-unpaid-at-door';

// Auto-enroll is a best-effort ADDED step layered on the check-in write. When it
// throws unexpectedly (offering-disabled/expired/not-found/family-not-found all
// re-throw out of autoEnrollBalaVihar) we still return the recorded check-in with
// this non-fatal marker rather than failing a check-in that already happened.
type EnrollResult = AutoEnrollResult | { enrolled: false; reason: 'error' };

/**
 * How long the door will wait for the "donation still pending" nudge before
 * moving on. Generous enough for a healthy Firestore read + SES call, short
 * enough that a sevak never notices. NOT a retry or a poll - one bounded wait.
 */
const DOOR_NUDGE_BUDGET_MS = 2500;

const bodySchema = z.object({
  id: z.string().min(1),
  students: z.record(z.string(), z.boolean()),
});

/**
 * Authenticated Setu kiosk check-in. Middleware (`canAccessRoute`) gates this
 * path to the `kiosk` role (admin inherits) BEFORE the handler runs, so the
 * handler trusts that gate and only re-checks the feature flag. It resolves the
 * entered id (publicFid or legacy check-in id) to a Setu family, records a
 * check-in event per selected student, then best-effort auto-enrolls the family
 * into the current Bala Vihar offering.
 */
export async function POST(req: Request) {
  if (!flags.checkInKiosk) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const family = await resolveKioskFamilyOrMigrate(parsed.data.id);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  // Record the check-in FIRST - this is the kiosk's primary job. Key the event
  // `fid` by the legacy check-in id when present (bridges the existing
  // check_in_events dashboards that read by the legacy id), else the publicFid,
  // else the CMT- doc id.
  const eventFid = family.legacyFid ?? family.publicFid ?? family.fid;
  const coll = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();
  const checkInIds: string[] = [];
  for (const [sid, isPresent] of Object.entries(parsed.data.students)) {
    const ref = await coll.add({
      fid: eventFid,
      sid,
      status: isPresent ? 'present' : 'absent',
      checkedInBy: 'sevak' as const,
      checkedInAt,
    });
    checkInIds.push(ref.id);
  }

  // Best-effort auto-enroll. autoEnrollBalaVihar swallows the two expected skip
  // cases (no-open-offering / no-eligible-members) but re-throws real
  // offering/family errors; those must NOT fail a check-in that was already
  // written, so catch and continue.
  let enroll: EnrollResult;
  try {
    enroll = await autoEnrollBalaVihar({ fid: family.fid, location: family.location });
  } catch (e) {
    console.error('[check-in/setu] auto-enroll failed (check-in already recorded)', e);
    enroll = { enrolled: false, reason: 'error' };
  }

  // Best-effort: mark each present child present in their Bala Vihar class
  // attendance for today, so the teacher just verifies (the door is the first
  // step). Present-only + create-only (never overrides a teacher's mark). Runs
  // AFTER auto-enroll so the child is on the level roster. A failure must not
  // fail a check-in that was already recorded.
  let attendance = { marked: 0 };
  try {
    const presentMids = Object.entries(parsed.data.students)
      .filter(([, isPresent]) => isPresent)
      .map(([mid]) => mid);
    const res = await markDoorAttendance({
      fid: family.fid,
      location: family.location,
      presentMids,
    });
    attendance = { marked: res.marked };
  } catch (e) {
    console.error('[check-in/setu] door attendance failed (check-in already recorded)', e);
  }

  // LAST, and after auto-enroll: a family who was just auto-enrolled by the two
  // steps above is exactly the "enrolled, donation pending" case this email is
  // for, and running before them would read the pre-enrollment state and say
  // nothing. Never throws, and the check-in is already written and returned
  // below regardless - see notifyUnpaidAtDoor.
  // BOUNDED. The AWS SES client sets no request or connection timeout (Smithy's
  // default is zero, i.e. wait forever), so a stalled SES call would hold this
  // response open until the platform killed it - leaving the sevak staring at a
  // spinner and retrying a check-in whose rows are already written. Found by a
  // Codex review, 2026-07-30.
  //
  // The nudge is abandoned, not cancelled: whatever is in flight completes or
  // fails on its own, and the 7-day claim it may already have taken means the
  // worst case is one missed nudge - never a duplicate. A missed nudge costs a
  // family seeing an outstanding donation their dashboard already shows.
  await Promise.race([
    notifyUnpaidAtDoor({ fid: family.fid, legacyFid: family.legacyFid }),
    new Promise<void>((resolve) => setTimeout(resolve, DOOR_NUDGE_BUDGET_MS)),
  ]);

  return NextResponse.json({
    family: {
      fid: family.fid,
      publicFid: family.publicFid,
      legacyFid: family.legacyFid,
      name: family.name,
    },
    enroll,
    attendance,
    checkInIds,
  });
}
