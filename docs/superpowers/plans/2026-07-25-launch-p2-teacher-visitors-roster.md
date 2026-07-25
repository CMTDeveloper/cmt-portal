# P2 - Teacher Attendance, Visitors & Roster - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rebuild the teacher attendance list to the supplied design, give welcome-team a visitors page, add a roster filter reset, and fix two live defects found during design.

**Architecture:** the attendance read model gains parent contact and payment status via **bulk collectionGroup reads joined in memory** - never a per-family fan-out, which times out at this roster size. The row is restructured from a single `<button>` into a container so a "View profile" link can sit beside the mark toggle without nesting interactive elements. Visitors reuses the existing `getLevelVisitorsView` across levels rather than per-level.

**Tech Stack:** Next.js 16 App Router, TypeScript, Firebase Admin Firestore, Vitest, Playwright.

## Global Constraints

See `2026-07-25-aug-3-launch-INDEX.md` § Global Constraints. The three that bite hardest here:

- **Bulk `collectionGroup` reads, never per-family fan-out.** A per-family loop times out at ~45s against 769 families. Join in memory.
- **Audit Firestore indexes** on every new query shape. Fake-firestore is index-blind.
- **N=2**: exercise every read path with two of everything - two children, two guests, two adults.

---

## File Structure

**Bug fixes (Tasks 1-2)**
- `apps/portal/src/features/setu/teacher/roster-confirmation.ts:77` - fid derivation
- `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts` - add `sessionDate`
- `apps/portal/src/features/setu/attendance/check-in-attendance.ts` - query `sessionDate`

**Teacher attendance (Tasks 3-5)**
- `apps/portal/src/features/setu/teacher/attendance-detail.ts` - NEW: bulk parent-contact + payment lookup
- `apps/portal/src/features/setu/teacher/level-attendance-view.ts` - widen `AttendanceViewRow`
- `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` - row restructure, table, drawer
- `apps/portal/src/features/setu/teacher/components/student-detail-drawer.tsx` - NEW

**Visitors + roster (Tasks 6-8)**
- `apps/portal/src/app/welcome/visitors/page.tsx` - NEW
- `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx` - grade filter
- `apps/portal/src/features/setu/roster/roster-browser.tsx` - Reset control

---

### Task 1: Fix the roster-confirmation `fid` bug

**A live defect.** `donations` is a top-level collection (`create-donation.ts:28` writes `db.collection('donations').doc()`), but `roster-confirmation.ts:77` derives the family id from `d.ref.parent.parent?.id`. For a top-level doc that is **always `null`**, so line 78 skips every donation and the completed-donation confirmation signal never fires on the teacher roster. A family who paid but has not attended reads **"Registered"** to their teacher and **"Enrolled"** on the dashboard and welcome roster.

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/roster-confirmation.ts:77`
- Test: `apps/portal/src/features/setu/teacher/__tests__/roster-confirmation.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: no signature change - a behaviour fix only

- [ ] **Step 1: Write the failing test**

```ts
it('confirms a family whose only signal is a completed donation', async () => {
  // Regression: donations is a TOP-LEVEL collection, so ref.parent.parent is
  // null and the old derivation skipped every donation. A welcome-team-enrolled
  // family who paid but has not attended must still read as confirmed.
  await seedEnrollment({ fid: 'CMT-PAID', pid: 'bv-brampton-2026-27', enrolledVia: 'welcome-team' });
  await seedDonation({ fid: 'CMT-PAID', eid: 'CMT-PAID-bv-brampton-2026-27', status: 'completed' });

  const confirmed = await deriveConfirmedFidsForLevel('brampton-level-2-2026-27', '2026-09-06');
  expect(confirmed.has('CMT-PAID')).toBe(true);
});
```

Match the file's existing fixture helpers; if none exist for donations, seed the doc directly with the fake-firestore instance the neighbouring tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster-confirmation`
Expected: FAIL - `confirmed` does not contain `CMT-PAID`.

- [ ] **Step 3: Fix the derivation**

`roster-confirmation.ts:77` becomes:

```ts
      // donations is a TOP-LEVEL collection, so ref.parent.parent is null.
      // Prefer the doc's own fid and keep the parent-path read as a fallback
      // for any future subcollection layout - the same defensive shape the
      // other three collectionGroup('donations') readers already use
      // (enrollment-report.ts:178, report-dataset.ts:111, build-csv-rows.ts:78).
      const fid = typeof data.fid === 'string' ? data.fid : d.ref.parent.parent?.id;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- roster-confirmation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/teacher/roster-confirmation.ts \
        apps/portal/src/features/setu/teacher/__tests__/roster-confirmation.test.ts
git commit -m "fix(teacher): completed-donation confirmation never fired on the roster

donations is a top-level collection, so ref.parent.parent is always null and
every donation was skipped. A promotion/welcome-team family who paid but had
not yet attended showed Registered to their teacher while showing Enrolled on
the dashboard and welcome roster - same family, three screens, two answers.

Uses the defensive fid derivation the other three collectionGroup readers
already use."
```

---

### Task 2: Fix the guest date-key mismatch

**A live defect.** The guest writer stamps `date: torontoYMD()` - the actual calendar day - while the teacher visitors page reads `mostRecentSunday()`. They coincide on Sundays, which is why it works today, so **any guest checked in on a non-Sunday is invisible to teachers**.

The fix writes **both** keys rather than changing the existing one: `date` stays for the admin reports that read it, and a new `sessionDate` carries the Sunday-normalized value the teacher views query.

**Files:**
- Modify: `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts`
- Modify: `apps/portal/src/features/setu/attendance/check-in-attendance.ts:168-201`
- Test: both modules' test files

**Interfaces:**
- Consumes: `mostRecentSunday` from `@/features/setu/calendar/calendar`
- Produces: `guest_check_ins` docs gain `sessionDate: string`; `readPortalGuestChildren(sessionDate: string)` now filters on it

- [ ] **Step 1: Write the failing test**

```ts
it('stamps sessionDate as the most recent Sunday, not the calendar day', async () => {
  // A guest who checks in on a Wednesday must still surface on that week's
  // Sunday teacher view. Attendance already normalizes this way
  // (mark-door-attendance.ts:61-64); guest check-in did not.
  vi.setSystemTime(new Date('2026-09-09T15:00:00Z')); // a Wednesday
  await recordGuestCheckIn({
    firstName: 'Meera', lastName: 'Iyer',
    email: 'meera@example.com', phone: '4165550111',
    numberOfAdults: 2,
    children: [{ name: 'Anaya Iyer', grade: '2' }, { name: 'Vivaan Iyer', grade: '5' }],
  });
  const doc = await lastGuestDoc();
  expect(doc.date).toBe('2026-09-09');        // calendar day, for admin reports
  expect(doc.sessionDate).toBe('2026-09-06'); // the Sunday teachers query
});
```

Note the **two** children - N=2 applies to the guest flatten path too.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- guest-check-ins`
Expected: FAIL - `sessionDate` is undefined.

- [ ] **Step 3: Write both keys**

In `guest-check-ins.ts`, import `mostRecentSunday` and add to the written document:

```ts
    // `date` is the literal Toronto calendar day, kept because the admin guest
    // list and reports read it. `sessionDate` is that day's Sunday - the key the
    // teacher attendance and visitors screens query, matching how
    // mark-door-attendance.ts:61-64 normalizes attendance. Writing both means a
    // midweek guest still surfaces to teachers, and no existing reader changes.
    date: torontoYMD(),
    sessionDate: mostRecentSunday(),
```

- [ ] **Step 4: Query the new key**

In `check-in-attendance.ts`, `readPortalGuestChildren` filters on `sessionDate` instead of `date`. Still a single-field equality, so Firestore auto-indexes it - **no composite index needed**. Rename the parameter to `sessionDate` for clarity and update the docstring.

- [ ] **Step 5: Backfill existing UAT docs**

Existing `guest_check_ins` docs have no `sessionDate` and would vanish from the teacher view. Write `apps/portal/scripts/backfill-guest-session-date.ts` following the repo's script conventions: UAT-guarded, `--dry-run` default, `--allow-prod` to override, idempotent (skip docs that already have the field). It sets `sessionDate = mostRecentSunday(new Date(date))` for every doc missing it.

Add a `pnpm` alias using `tsx --env-file=.env.local`, per repo rule - a bare `pnpm exec tsx` does not load env.

- [ ] **Step 6: Run the backfill against UAT and update the runbook**

```bash
pnpm --filter @cmt/portal backfill:guest-session-date --dry-run
pnpm --filter @cmt/portal backfill:guest-session-date
```

Add the new field to §3 of `docs/runbooks/production-cutover-checklist.md`, the script to §10, and a dated §14 entry. **Required** - a UAT DB operation without a runbook entry is an incomplete change.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @cmt/portal test -- guest-check-ins check-in-attendance visitors`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts \
        apps/portal/src/features/setu/attendance/check-in-attendance.ts \
        apps/portal/scripts/backfill-guest-session-date.ts \
        apps/portal/package.json docs/runbooks/production-cutover-checklist.md
git commit -m "fix(check-in): non-Sunday guests were invisible to teachers

The guest writer stamped date=torontoYMD() (calendar day) while the teacher
visitors view reads mostRecentSunday(). They coincide on Sundays, which is
why nobody noticed, but any midweek guest never reached a teacher.

Writes both keys rather than changing the existing one: date stays for the
admin reports that read it, sessionDate carries the Sunday-normalized value
teachers query. Single-field equality, so no composite index. Includes an
idempotent backfill for existing docs."
```

---

### Task 3: Bulk parent-contact and payment lookup

The attendance read model carries **neither** parent contact nor payment status today. Both are added with bulk reads joined in memory.

**Files:**
- Create: `apps/portal/src/features/setu/teacher/attendance-detail.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/attendance-detail.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface StudentContact {
    parentName: string | null;
    parentPhone: string | null;
    parentEmail: string | null;
  }
  export type StudentPayment = 'paid' | 'outstanding' | 'unknown';
  export interface AttendanceDetailIndex {
    contactByFid: Map<string, StudentContact>;
    paymentByFid: Map<string, StudentPayment>;
  }
  export async function buildAttendanceDetailIndex(fids: readonly string[]): Promise<AttendanceDetailIndex>
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe('buildAttendanceDetailIndex', () => {
  it('resolves contact and payment for TWO families in bulk', async () => {
    await seedFamily({ fid: 'CMT-A', adults: [
      { mid: 'CMT-A-01', firstName: 'Vaibhav', lastName: 'Rana', phone: '6473852434', email: 'v@example.com', manager: true },
      { mid: 'CMT-A-02', firstName: 'Harshita', lastName: 'Rana', phone: '6473852435', email: 'h@example.com' },
    ]});
    await seedFamily({ fid: 'CMT-B', adults: [
      { mid: 'CMT-B-01', firstName: 'Rina', lastName: 'Arora', phone: '6471234567', email: 'r@example.com', manager: true },
    ]});
    await seedEnrollmentWithAmount({ fid: 'CMT-A', expected: 500 });
    await seedDonation({ fid: 'CMT-A', status: 'completed', amountCAD: 500 });
    await seedEnrollmentWithAmount({ fid: 'CMT-B', expected: 500 });

    const idx = await buildAttendanceDetailIndex(['CMT-A', 'CMT-B']);

    expect(idx.contactByFid.get('CMT-A')).toEqual({
      parentName: 'Vaibhav Rana', parentPhone: '6473852434', parentEmail: 'v@example.com',
    });
    expect(idx.contactByFid.get('CMT-B')?.parentName).toBe('Rina Arora');
    expect(idx.paymentByFid.get('CMT-A')).toBe('paid');
    expect(idx.paymentByFid.get('CMT-B')).toBe('outstanding');
  });

  it('returns empty maps for an empty fid list without querying', async () => {
    const idx = await buildAttendanceDetailIndex([]);
    expect(idx.contactByFid.size).toBe(0);
    expect(idx.paymentByFid.size).toBe(0);
  });
});
```

**Two families, and the first has two adults** - a single-family fixture cannot catch an implementation that returns the same contact for everyone, and a single-adult fixture cannot catch one that picks an arbitrary adult instead of the manager.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- attendance-detail`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement with bulk reads**

```ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { paymentFromAmounts } from '@/features/setu/roster/payment';

export interface StudentContact {
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
}
export type StudentPayment = 'paid' | 'outstanding' | 'unknown';
export interface AttendanceDetailIndex {
  contactByFid: Map<string, StudentContact>;
  paymentByFid: Map<string, StudentPayment>;
}

/**
 * Parent contact + payment status for a set of families, in BULK.
 *
 * Deliberately not a per-family fan-out: this runs on every teacher
 * attendance render, and a per-family loop times out at roster scale
 * (~45s @ 769 families, documented). One unfiltered collectionGroup read
 * per concern, filtered and joined in memory - the same index-free pattern
 * roster-confirmation.ts uses.
 *
 * The contact is the family MANAGER's, falling back to the first adult, so
 * a teacher always sees the person to call.
 */
export async function buildAttendanceDetailIndex(
  fids: readonly string[],
): Promise<AttendanceDetailIndex> {
  const contactByFid = new Map<string, StudentContact>();
  const paymentByFid = new Map<string, StudentPayment>();
  if (fids.length === 0) return { contactByFid, paymentByFid };

  const wanted = new Set(fids);
  const db = portalFirestore();

  const [membersSnap, enrollSnap, donationSnap] = await Promise.all([
    db.collectionGroup('members').get(),
    db.collectionGroup('enrollments').where('status', '==', 'active').get(),
    db.collectionGroup('donations').get(),
  ]);

  // Contact: prefer the manager, else the first adult encountered.
  const firstAdult = new Map<string, StudentContact>();
  for (const d of membersSnap.docs) {
    const fid = d.ref.parent.parent?.id;
    if (!fid || !wanted.has(fid)) continue;
    const m = d.data() as Record<string, unknown>;
    if (m['type'] !== 'Adult') continue;
    const contact: StudentContact = {
      parentName: [m['firstName'], m['lastName']].filter(Boolean).join(' ').trim() || null,
      parentPhone: (m['phone'] as string | null) ?? null,
      parentEmail: (m['email'] as string | null) ?? null,
    };
    if (m['manager'] === true) contactByFid.set(fid, contact);
    else if (!firstAdult.has(fid)) firstAdult.set(fid, contact);
  }
  for (const [fid, contact] of firstAdult) {
    if (!contactByFid.has(fid)) contactByFid.set(fid, contact);
  }

  // Payment: expected across active enrollments vs completed donations.
  const expectedByFid = new Map<string, number>();
  const activeCountByFid = new Map<string, number>();
  for (const d of enrollSnap.docs) {
    const fid = d.ref.parent.parent?.id;
    if (!fid || !wanted.has(fid)) continue;
    const e = d.data() as { suggestedAmountOverride?: number | null; suggestedAmountSnapshot?: number };
    const amount = e.suggestedAmountOverride ?? e.suggestedAmountSnapshot ?? 0;
    expectedByFid.set(fid, (expectedByFid.get(fid) ?? 0) + amount);
    activeCountByFid.set(fid, (activeCountByFid.get(fid) ?? 0) + 1);
  }

  const paidByFid = new Map<string, number>();
  for (const d of donationSnap.docs) {
    const data = d.data() as { fid?: string; status?: string; amountCAD?: number };
    // donations is top-level: prefer the doc's own fid (see Task 1).
    const fid = typeof data.fid === 'string' ? data.fid : d.ref.parent.parent?.id;
    if (!fid || !wanted.has(fid)) continue;
    if (data.status !== 'completed') continue;
    paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + (data.amountCAD ?? 0));
  }

  for (const fid of wanted) {
    paymentByFid.set(
      fid,
      paymentFromAmounts(activeCountByFid.get(fid) ?? 0, expectedByFid.get(fid) ?? 0, paidByFid.get(fid) ?? 0),
    );
  }

  return { contactByFid, paymentByFid };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- attendance-detail`
Expected: PASS.

- [ ] **Step 5: Audit indexes**

The only filtered query is `collectionGroup('enrollments').where('status','==','active')` - a single-field collectionGroup equality, which is **not** auto-indexed. Confirm `firestore.indexes.json` already carries a matching entry; the existing `enrollments (pid, status)` composite does **not** serve a bare `status` query. If absent, add a single-field override and deploy to UAT only:

```bash
firebase deploy --only firestore:indexes --project chinmaya-setu-uat
```

Follow the `auditing-firestore-indexes` skill. Record any new index in runbook §5 plus a dated §14 entry.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/teacher/attendance-detail.ts \
        apps/portal/src/features/setu/teacher/__tests__/attendance-detail.test.ts \
        firestore.indexes.json docs/runbooks/production-cutover-checklist.md
git commit -m "feat(teacher): bulk parent-contact and payment index for attendance

Neither field exists in the attendance read model today. Built with bulk
collectionGroup reads joined in memory rather than a per-family fan-out,
which times out at roster scale. Contact prefers the family manager and
falls back to the first adult. Tested with two families, the first having
two adults."
```

---

### Task 4: Widen the attendance view model

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/level-attendance-view.ts:7-17`
- Test: `apps/portal/src/features/setu/teacher/__tests__/level-attendance-view.test.ts`

**Interfaces:**
- Consumes: `buildAttendanceDetailIndex` from Task 3
- Produces: `AttendanceViewRow` gains `parentName`, `parentPhone`, `parentEmail`, `payment`, `safetyNotes`

- [ ] **Step 1: Write the failing test**

```ts
it('carries parent contact and payment onto every row', async () => {
  const view = await getLevelAttendanceView('brampton-level-2-2026-27', '2026-09-06');
  expect(view!.rows).toHaveLength(2);
  expect(view!.rows[0]).toMatchObject({
    parentName: 'Vaibhav Rana', parentPhone: '6473852434',
    parentEmail: 'v@example.com', payment: 'paid',
  });
  expect(view!.rows[1]).toMatchObject({ parentName: 'Rina Arora', payment: 'outstanding' });
});
```

Two rows from two different families - a single-row fixture cannot catch a join that assigns the same contact to everyone.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- level-attendance-view`
Expected: FAIL - properties absent.

- [ ] **Step 3: Widen the type and join**

Add to `AttendanceViewRow`:

```ts
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  payment: StudentPayment;
  /** Allergy / medical text, surfaced as readable text in the detail drawer.
   *  The row keeps the existing red dot; this is the same data spelled out. */
  safetyNotes: string | null;
```

In `getLevelAttendanceView`, after `deriveRoster` resolves, collect the distinct fids, call `buildAttendanceDetailIndex(fids)` **once**, and map each row from the index. Do not call it per row.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- level-attendance-view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/teacher/level-attendance-view.ts \
        apps/portal/src/features/setu/teacher/__tests__/level-attendance-view.test.ts
git commit -m "feat(teacher): carry parent contact, payment and safety notes on rows

One bulk index lookup per render, joined onto every row. Tested with two
rows from two different families so a shared-contact join bug cannot pass."
```

---

### Task 5: Rebuild the attendance UI

Implements the supplied design: desktop table with a detail drawer, mobile cards.

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx`
- Create: `apps/portal/src/features/setu/teacher/components/student-detail-drawer.tsx`
- Test: `apps/portal/src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx`

**Interfaces:**
- Consumes: the widened `AttendanceViewRow` from Task 4
- Produces: no new exported types

- [ ] **Step 1: Write the failing test**

```tsx
const ROWS = [
  { mid: 'CMT-A-03', fid: 'CMT-A', firstName: 'Dhruv', lastName: 'Anish', schoolGrade: '2',
    hasSafetyInfo: false, status: 'present', source: 'portal', checkedInAtDoor: false,
    parentName: 'Vaibhav Rana', parentPhone: '6473852434', parentEmail: 'v@example.com',
    payment: 'paid', safetyNotes: null },
  { mid: 'CMT-B-02', fid: 'CMT-B', firstName: 'Vaanvi', lastName: 'Arora', schoolGrade: '2',
    hasSafetyInfo: true, status: null, source: 'default', checkedInAtDoor: false,
    parentName: 'Rina Arora', parentPhone: '6471234567', parentEmail: 'r@example.com',
    payment: 'outstanding', safetyNotes: 'Peanut allergy' },
];

it('renders parent contact and a donation chip per student', () => {
  render(<AttendanceMarker rows={ROWS} /* ...other required props */ />);
  expect(screen.getByText('Vaibhav Rana')).toBeInTheDocument();
  expect(screen.getByText('6473852434')).toBeInTheDocument();
  expect(screen.getByText(/donation complete/i)).toBeInTheDocument();
  expect(screen.getByText(/donation pending/i)).toBeInTheDocument();
});

it('gives every student a View profile link that is NOT nested in the mark control', () => {
  render(<AttendanceMarker rows={ROWS} /* ... */ />);
  const link = screen.getAllByRole('link', { name: /view profile/i })[0]!;
  expect(link).toHaveAttribute('href', '/teacher/students/CMT-A-03');
  // Invalid HTML and a keyboard trap if the link sits inside the toggle button.
  expect(link.closest('button')).toBeNull();
});

it('marking a student present does not navigate', async () => {
  const onMark = vi.fn();
  render(<AttendanceMarker rows={ROWS} onMark={onMark} /* ... */ />);
  await userEvent.click(screen.getAllByRole('button', { name: /mark/i })[0]!);
  expect(onMark).toHaveBeenCalledWith('CMT-A-03', expect.anything());
});
```

The second test is the structural one. Rows are `<button>` elements today, so a nested link is invalid HTML and breaks keyboard navigation.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- attendance-marker`
Expected: FAIL - no contact rendered, no link.

- [ ] **Step 3: Restructure the row**

Replace the row `<button>` with a container element. Inside it:
- the mark toggle is its own `<button>`
- "View profile" is its own `<Link href={/teacher/students/${mid}}>`
- tapping the row body still marks, via a click handler on the container that ignores events originating inside the link

Desktop columns, per the design: Student (avatar + name) · Grade / Level · Primary Parent · Contact (phone + email stacked) · Donation Status chip · View profile · Attendance.

Mobile (`md:hidden`): a card per student - avatar, name, `Grade · Level`, donation chip, View button, mark toggle. Both layouts render from the same row data; **no second data path**.

- [ ] **Step 4: Build the detail drawer**

`student-detail-drawer.tsx` renders the selected student: name + `Grade · Level`; **Attendance** (status + Mark/Unmark); **Registration** (enrollment + donation chips); **Primary Parent** (name, phone, email); **Safety & medical** rendering `safetyNotes` as readable text when present; **Actions** (`View full profile`, `View registration`); and the note *"Need to update information? You can request updates from the parent through the student profile."*

> The safety block is the one deviation from the supplied sample, per spec §4.3: the row keeps the existing red dot, and the drawer spells the notes out. Dense table stays dense; the information becomes reachable.

- [ ] **Step 5: Run tests and lint**

Run: `pnpm --filter @cmt/portal test -- attendance-marker && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Playwright E2E against deployed UAT**

Extend or create `apps/portal/e2e/setu/teacher/attendance.spec.ts`:
- password sign-in as the teacher persona (**never OTP**)
- open a level with **two enrolled students from two different families**
- assert both parents' contact and both donation chips render, and that they differ
- click View profile and land on `/teacher/students/[mid]`
- mark one present; reload; assert it persisted
- resize to a mobile viewport and assert the card layout renders

Run: `pnpm test:e2e -- attendance`

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/teacher/components/ \
        apps/portal/e2e/setu/teacher/attendance.spec.ts
git commit -m "feat(teacher): rebuild the attendance list to the supplied design

Desktop table with parent contact, donation chip and a per-student detail
drawer; mobile cards from the same row data. Rows were single <button>
elements, so they are restructured into containers - a nested View profile
link would be invalid HTML and a keyboard trap. A test pins that the link is
not inside a button.

Allergy and medical notes render as readable text in the drawer while the
row keeps its red dot, per spec 4.3."
```

---

### Task 6: `/welcome/visitors`

**Files:**
- Create: `apps/portal/src/app/welcome/visitors/page.tsx`
- Create: `apps/portal/src/features/setu/welcome/visitors-view.ts`
- Test: `apps/portal/src/features/setu/welcome/__tests__/visitors-view.test.ts`

**Interfaces:**
- Consumes: `getLevelVisitorsView` (`features/setu/teacher/visitors.ts`), `readPortalGuestChildren` (Task 2)
- Produces: `getAllVisitorsForDate(sessionDate: string): Promise<VisitorsByLevel[]>`

- [ ] **Step 1: Write the failing test**

Assert that with **two guest families across two levels**, the view returns both levels with the right children grouped under each, and that a guest whose grade matches no level still appears in an "unmatched" group rather than vanishing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- visitors-view`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Read the enabled levels once, then group the date's guest children by level using the existing `guestMatchesLevel` predicate (`visitors.ts:15-23`) so teacher and welcome views can never disagree. Children matching no level go into an explicit unmatched bucket - a guest who is invisible to everyone is worse than one in the wrong place.

- [ ] **Step 4: Build the page**

Server component at `/welcome/visitors`, listing levels with their visitors, with a date control defaulting to `mostRecentSunday()`. `canAccessRoute` already grants `/welcome/*` to welcome-team and (from P1 Task 3) coordinator, so **no new rule is needed** - confirm with a test rather than assuming.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test -- visitors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/welcome/visitors/ apps/portal/src/features/setu/welcome/
git commit -m "feat(welcome): visitors page for welcome-team and coordinator

Visitors was teacher-only and per-level. This groups a date's guests across
every enabled level, reusing guestMatchesLevel so the two views can never
disagree. Guests matching no level surface in an explicit unmatched group
rather than disappearing."
```

---

### Task 7: Visitor grade filter

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx`
- Test: its test file

**Interfaces:**
- Consumes: `VisitorRow.grade`, already present (`visitors.ts:25-31`)
- Produces: none

- [ ] **Step 1: Write the failing test**

Render with visitors in grades 2 and 5; select grade 2; assert only the grade-2 visitor remains and the grade-5 one is gone.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- visitors-panel`
Expected: FAIL - no filter control.

- [ ] **Step 3: Implement**

A client-side filter over the already-loaded rows. `grade` is already on every `VisitorRow`, so there is **no new read and no index**. Options derive from the grades actually present, so the control never offers an empty filter.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- visitors-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/teacher/components/visitors-panel.tsx
git commit -m "feat(teacher): filter the visitor list by grade

Client-side over already-loaded rows - grade is already on every VisitorRow,
so no new read and no index. Options derive from the grades present."
```

---

### Task 8: Roster Reset button

**Files:**
- Modify: `apps/portal/src/features/setu/roster/roster-browser.tsx`
- Test: its test file

**Interfaces:**
- Consumes: existing filter state at `roster-browser.tsx:246-251`
- Produces: none

- [ ] **Step 1: Write the failing test**

```tsx
it('Reset returns filters to their defaults', async () => {
  render(<RosterBrowser {...props} />);
  await userEvent.selectOptions(screen.getByLabelText(/payment/i), 'outstanding');
  await userEvent.type(screen.getByPlaceholderText(/search/i), 'Rana');

  await userEvent.click(screen.getByRole('button', { name: /reset/i }));

  expect(screen.getByLabelText(/payment/i)).toHaveValue('paid');       // documented default
  expect(screen.getByLabelText(/engagement/i)).toHaveValue('enrolled'); // documented default
  expect(screen.getByPlaceholderText(/search/i)).toHaveValue('');
});

it('Reset is not offered when filters are already at their defaults', () => {
  render(<RosterBrowser {...props} />);
  expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster-browser`
Expected: FAIL - no Reset control.

- [ ] **Step 3: Implement**

Add a Reset control that restores `payment='paid'`, `engagement='enrolled'`, and clears search, location and program. Derive one `isDefault` boolean and hide Reset when true, so it never reads as a live control that does nothing.

**Reset does not touch `?year=`.** The school year is a *scope* selected in its own bar (`school-year-scope-bar.tsx:95-105`) and lives in the URL, not among the filter chips - resetting it would silently move the user to a different year's data.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- roster-browser`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/roster/roster-browser.tsx
git commit -m "feat(roster): add a Reset filters control

Restores the documented defaults (payment=paid, engagement=enrolled) and
clears search, location and program. Hidden when filters are already at
their defaults. Deliberately does not touch ?year= - the school year is a
scope in its own bar, and resetting it would move the user to another
year's data."
```

---

## Self-Review

**Spec coverage** - `2026-07-24-aug-3-launch-batch-design.md`:
- §4.1-4.2 desktop table + mobile cards → Task 5 ✅
- §4.3 allergies in the drawer → Task 5 Step 4 ✅
- §4.4 bulk reads, no fan-out, index audit → Task 3 ✅
- §4.5 row restructure away from `<button>` → Task 5 Steps 1, 3 ✅
- §5.1 guest date-key defect D1 → Task 2 ✅
- §5.2 `/welcome/visitors` → Task 6 ✅
- §5.3 guest→teacher E2E → Task 5 Step 6 and Task 6 ✅
- §5.4 visitor grade filter → Task 7 ✅
- §6 roster Reset, `?year=` untouched → Task 8 ✅
- Adult-study-class spec §5 roster-confirmation fid bug → Task 1 ✅

Not in this plan, by design: roles and cross-family edit (P1), SMS posture (P3 sibling / launch batch §8 - **see gap note below**).

> **Coverage gap flagged:** launch-batch spec §8 (SMS sign-in unsupported + `+1` gate) is not covered by P1, P2, or P3. It needs a home. It is small and self-contained; the reviewer should confirm it lands in P3 or a short P6 rather than being lost between plans.

**Placeholder scan:** no TBD/TODO. Every code step carries real code or an exact structural instruction. Tasks 6-8 describe UI structure rather than pasting full components, because each is a modification to an existing file whose surrounding conventions must be followed - the tests pin the required behaviour precisely.

**Type consistency:** `StudentContact` / `StudentPayment` / `AttendanceDetailIndex` (Task 3) are consumed in Task 4 with matching names. The `AttendanceViewRow` fields added in Task 4 (`parentName`, `parentPhone`, `parentEmail`, `payment`, `safetyNotes`) are exactly the ones Task 5's fixtures use. `sessionDate` (Task 2) is the parameter name in both the writer and `readPortalGuestChildren`, and Task 6 consumes it under the same name.
