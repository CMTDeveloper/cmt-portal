import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { sessionDateFor } from '@cmt/shared-domain';

/** One guest child captured at self-serve check-in: name + grade so a teacher
 *  can match the child to their class. Grade is a CHILD_GRADE_OPTIONS value. */
export interface GuestChildInput {
  name: string;
  grade: string;
}

export interface GuestCheckInInput {
  firstName: string;
  lastName: string;
  // Email + phone are REQUIRED now so a checked-in guest family is always
  // reachable/claimable (Vaibhav) — the route enforces this.
  email: string;
  phone: string;
  numberOfAdults: number;
  // Per-child name + grade (replaces the old bare count). May be empty for an
  // adults-only visit. `numberOfChildren` is derived from this on write.
  children: GuestChildInput[];
  notes?: string;
}

/** Today's date as `YYYY-MM-DD` in America/Toronto, regardless of the server's
 *  UTC clock. This is the actual walk-in day; it is NOT the key the teacher
 *  screens query by (see `sessionDate` below). */
function torontoYMD(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function recordGuestCheckIn(input: GuestCheckInInput): Promise<string> {
  // Read the clock ONCE. Two torontoYMD() calls are two independent reads and
  // can straddle a Toronto midnight, which would stamp a `sessionDate` that is
  // not the Sunday of the recorded `date`.
  const ymd = torontoYMD();
  const ref = await portalFirestore().collection('guest_check_ins').add({
    ...input,
    // Keep the derived count so the admin guest list / stats / reports (which
    // read numberOfChildren) keep working without change.
    numberOfChildren: input.children.length,
    // `date` is the actual Toronto calendar day the guest walked in. Kept for
    // forensic value and because rewriting existing docs would destroy it. It
    // has no PRIMARY reader after this change: its only one was
    // check-in-attendance.ts, which now queries `sessionDate` and reads `date`
    // only as a transitional fallback. Do not assume it is load-bearing.
    date: ymd,
    // `sessionDate` is the Sunday teachers actually view. Bala Vihar runs on
    // Sundays and every teacher surface defaults its ?date= to
    // mostRecentSunday(), so a guest who walked in midweek was invisible to
    // them. Same normalization mark-door-attendance.ts:64 already does.
    sessionDate: sessionDateFor(ymd),
    // `checkedInAt` stays a full ISO instant for the admin reports timeline.
    checkedInAt: new Date().toISOString(),
  });
  return ref.id;
}
