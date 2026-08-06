import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { sessionDateFor, normalizeGuestChildField } from '@cmt/shared-domain';

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

/**
 * `onDate` (YYYY-MM-DD) overrides the walk-in day. The kiosk never passes it -
 * a self-serve guest is always checking in NOW - but the front desk records
 * visitors from a screen with a date picker on it, and stamping "today" for a
 * desk viewing last Sunday would file the guest somewhere the person who just
 * typed them in cannot see. Absent, the behaviour is exactly as before.
 */
export async function recordGuestCheckIn(
  input: GuestCheckInInput,
  onDate?: string,
): Promise<string> {
  // Read the clock ONCE. Two torontoYMD() calls are two independent reads and
  // can straddle a Toronto midnight, which would stamp a `sessionDate` that is
  // not the Sunday of the recorded `date`.
  const ymd = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : torontoYMD();
  const ref = await portalFirestore().collection('guest_check_ins').add({
    ...input,
    // ⚠️ INVARIANT: `children` is APPEND-AT-CREATION ONLY. Nothing reorders it,
    // inserts into it, or removes from it - this function writes it once, and
    // `updateGuestChild` only ever rewrites an element in place. The whole
    // correction feature addresses a child by its POSITION here, so the first
    // writer that shifts elements silently re-points every open edit form at a
    // different child. If a delete-child or add-child slice ever ships, give
    // each child a stable id first and address by that; do not just add the
    // operation. The compare-and-swap would be the only thing left standing
    // between a reorder and a wrong-child write.
    // Keep the derived count so the admin guest list / stats / reports (which
    // read numberOfChildren) keep working without change.
    numberOfChildren: input.children.length,
    // `date` is the Toronto calendar day the visit is RECORDED AGAINST. For a
    // kiosk self-check-in that is the day they walked in; for a front-desk row
    // carrying an explicit `onDate` it is the Sunday the desk was viewing, which
    // may not be today. The real instant is always `checkedInAt`. Kept for
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

/** Why a correction was refused. Each reason is a DIFFERENT thing for the desk
 *  to do about it, which is why they are not one generic failure. */
export type UpdateGuestChildFailure =
  /** The visit was deleted (or the id is wrong) - nothing to correct. */
  | 'not-found'
  /** A pre-2026-07-24 document with a bare count and no `children` array. There
   *  is no child row to address, so a positional edit is meaningless. */
  | 'no-children'
  /** The visit exists but has no child at that position. */
  | 'index-out-of-range'
  /** Someone else changed this child between the read and the save. */
  | 'changed';

export type UpdateGuestChildResult = { ok: true } | { ok: false; reason: UpdateGuestChildFailure };

export interface UpdateGuestChildParams {
  docId: string;
  childIndex: number;
  /** What the desk was SHOWN, child AND visit contact. The write refuses unless
   *  it is still true - see the contact rules in the docblock below. */
  expected: { name: string; grade: string; contact: GuestVisitContact };
  child: { name: string; grade: string };
  /** Belongs to the VISIT, so it necessarily applies to that visit's other
   *  children too. The form says so. */
  contact: GuestVisitContact;
  editedByUid: string | null;
}

export interface GuestVisitContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const CONTACT_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const;

/**
 * Field-by-field equality under the display normalization, so a stored null
 * phone and a form's '' are the same contact and not a phantom edit.
 *
 * `b` is deliberately `unknown`: it is called both with a typed snapshot and
 * with the raw Firestore document, and an interface has no index signature so it
 * is not assignable to `Record<string, unknown>`. Narrowing here keeps both call
 * sites honest without casting at either of them.
 */
function sameContact(a: GuestVisitContact, b: unknown): boolean {
  const other = (b ?? {}) as Record<string, unknown>;
  return CONTACT_FIELDS.every(
    (f) => normalizeGuestChildField(a[f]) === normalizeGuestChildField(other[f]),
  );
}

/**
 * Correct ONE child of an existing guest visit, plus the visit's contact.
 *
 * ── Why a transaction with a compare-and-swap ────────────────────────────────
 * `children` is a plain array, so a child's only address is its position, and a
 * position is not an identity. Two people work the desk on a Sunday morning;
 * `arrayRemove`/`arrayUnion` cannot express "replace element 2"; and a
 * read-then-write without a guard would let the second save silently overwrite
 * a different child than the one its author was looking at. So the desk sends
 * back what it was shown and the write refuses if the document has moved on -
 * `expected` compared under the SAME normalization the board rendered with.
 *
 * ── What it deliberately does NOT touch ─────────────────────────────────────
 * `date` and `sessionDate` are left exactly as they are. They decide which
 * Sunday - and therefore which teacher - a guest belongs to; a correction screen
 * that silently re-filed the visit would move it off the board the corrector is
 * looking at. `checkedInAt` likewise stays the original instant: it is when they
 * walked in, not when someone fixed a typo.
 *
 * `numberOfChildren` IS rewritten from the array, because it is derived and this
 * is the only other writer of `children`. It cannot drift here (the array length
 * is unchanged by an in-place edit), but re-deriving it costs nothing and means
 * the two can never disagree after a write from this path.
 */
export async function updateGuestChild(
  params: UpdateGuestChildParams,
): Promise<UpdateGuestChildResult> {
  const db = portalFirestore();
  const ref = db.collection('guest_check_ins').doc(params.docId);

  return db.runTransaction<UpdateGuestChildResult>(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not-found' };

    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const kids = data['children'];
    // Array.isArray, not a truthiness check: documents written before b1395e0
    // carry `numberOfChildren` and no `children` key at all.
    if (!Array.isArray(kids)) return { ok: false, reason: 'no-children' };
    // `< 0` as well as `>= length`. The route's schema already blocks a negative
    // index, but this helper is exported and a caller reaching it directly with
    // -1 would slip through every check below: `kids[-1]` is undefined, which
    // normalizes to two empty strings and can SATISFY the compare-and-swap, and
    // the map then matches no element - so the write would touch no child, still
    // rewrite the contact, and answer ok. Cheap to close here rather than rely
    // on one caller's validation forever.
    if (params.childIndex < 0 || params.childIndex >= kids.length) {
      return { ok: false, reason: 'index-out-of-range' };
    }

    const current = (kids[params.childIndex] ?? {}) as { name?: unknown; grade?: unknown };
    if (
      normalizeGuestChildField(current.name) !== params.expected.name ||
      normalizeGuestChildField(current.grade) !== params.expected.grade
    ) {
      return { ok: false, reason: 'changed' };
    }

    // ── The contact, which is the visit's and not this child's ───────────────
    // Every correction submits all four contact fields whether or not the desk
    // touched them, so writing them unconditionally would let a grade-only save
    // push its stale contact over somebody else's fix.
    //
    // Decided by comparing the submission to the SNAPSHOT, not to the document:
    //   - unchanged  -> do not write the contact at all. A grade fix then cannot
    //                   disturb a contact fix, and needs no conflict to say so.
    //   - changed    -> the desk means it, so require the document to still hold
    //                   what they were shown before overwriting it.
    // Strictly better than always comparing: same protection, no false 409 for
    // the common case of correcting only a grade.
    const contactEdited = !sameContact(params.contact, params.expected.contact);
    if (contactEdited && !sameContact(params.expected.contact, data)) {
      return { ok: false, reason: 'changed' };
    }

    // Spread the existing element rather than replacing it: a child object may
    // carry fields this route knows nothing about, and a correction to a grade
    // must not silently drop them.
    const next = kids.map((kid, i) =>
      i === params.childIndex
        ? { ...(kid as Record<string, unknown>), name: params.child.name, grade: params.child.grade }
        : kid,
    );

    txn.update(ref, {
      children: next,
      numberOfChildren: next.length,
      ...(contactEdited
        ? {
            firstName: params.contact.firstName,
            lastName: params.contact.lastName,
            email: params.contact.email,
            phone: params.contact.phone,
          }
        : {}),
      // Denormalized onto the document instead of `audit_log`, which is
      // write-only in this codebase (zero readers) and has no index to read by.
      lastEditedAt: new Date().toISOString(),
      lastEditedByUid: params.editedByUid,
    });
    return { ok: true };
  });
}
