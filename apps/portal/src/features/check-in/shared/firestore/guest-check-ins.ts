import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

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

/** Today's date as `YYYY-MM-DD` in America/Toronto — the same key the teacher
 *  attendance/visitors screens query by, so a door guest surfaces on the day
 *  they checked in regardless of the server's UTC clock. */
function torontoYMD(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function recordGuestCheckIn(input: GuestCheckInInput): Promise<string> {
  const ref = await portalFirestore().collection('guest_check_ins').add({
    ...input,
    // Keep the derived count so the admin guest list / stats / reports (which
    // read numberOfChildren) keep working without change.
    numberOfChildren: input.children.length,
    // `date` (Toronto YMD) is what the teacher visitors query filters on;
    // `checkedInAt` stays a full ISO instant for the admin reports timeline.
    date: torontoYMD(),
    checkedInAt: new Date().toISOString(),
  });
  return ref.id;
}
