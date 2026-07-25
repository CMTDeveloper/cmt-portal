# P2 v2 - Teacher Attendance, Visitors & Roster

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two live production defects, rebuild the teacher attendance screen to the supplied design, add a welcome-team visitors page with a grade filter, and add a Reset control to the roster.

**Architecture:** Two independent production bug fixes ship first and alone (Tasks 1-2). Then the attendance work (Tasks 3-5), which widens the roster read model with parent contact, donation status and allergy text, then rebuilds the row from a `<button>` into a container with an independent toggle and link. Then visitors (Tasks 6-7), roster reset (Task 8), and the guest→teacher E2E the spec has been missing (Task 9).

**Tech Stack:** Next.js 16 App Router, TypeScript (`exactOptionalPropertyTypes`), Firebase Admin Firestore, Vitest + Testing Library, Playwright.

**Supersedes:** `2026-07-25-launch-p2-teacher-visitors-roster.md`, reviewed as REQUEST CHANGES (2 critical, 9 major, 6 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p2.md`. **Both of v1's headline bug diagnoses were correct and are carried forward unchanged** - the defects were in the fixes and the tests, not the analysis.

**Spec:** `docs/superpowers/specs/2026-07-24-aug-3-launch-batch-design.md` §4, §5, §6.

---

## Global Constraints

- **Bulk reads, never a per-family fan-out over the roster.** Per-family loops time out at ~45s @ 769 families. The rule targets **roster-scoped** loops; a **level-scoped** bounded read (20-40 families) is fine and already precedented at `student-detail.ts:62`. Say which one you are doing, in a comment, every time.
- **Audit Firestore indexes on any query change.** Fake-firestore is index-blind. This plan is designed to need **zero** new indexes - if you find yourself adding a multi-`where` or a `.where().orderBy()`, stop and re-read the task.
- **jsdom renders BOTH responsive branches.** `block md:hidden` and `hidden md:block` both mount, every element appears twice, and **each branch owns independent React state**. Use `getAllBy*`/`findAllBy*` and act on **every** match. Documented at `features/setu/roster/__tests__/roster-browser.test.tsx:49-53` and `reports/__tests__/reports-hub.test.tsx:54`. `getBy*` throws on multiple matches.
- **`/api/setu/**` response-shape changes need a `MOBILE_API_CHANGELOG.md` entry** in the same commit (dated, SHA-keyed). `GET /api/setu/teacher/levels/[levelId]/roster` returns `{ view }` verbatim (`route.ts:24-26`), so widening `AttendanceViewRow` **is** such a change.
- **All Firestore work targets `chinmaya-setu-uat`.** Never prod `chinmaya-setu-715b8`, never `--force`.
- **Never parse a `YYYY-MM-DD` with a bare `new Date(ymd)`.** That is UTC midnight, which is the previous evening in Toronto. Always anchor: `new Date(\`${ymd}T12:00:00Z\`)`. This is the C1 defect and the repo already uses the anchor at `calendar.ts:42` and `attendance-marker.tsx:29-33`.
- **No em dashes** in code, comments, commit messages or docs. **Commit author** `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### Ordering

**Tasks 1 and 2 are live production defects and are independent of everything else. Ship them first, alone.** Do not let the attendance rebuild gate them. Tasks 3-5 are the largest and riskiest part of this plan; Tasks 6-9 are independent of 3-5.

### Deliberate deviations from the spec

1. **Spec §6 omits `level` and `grade` from Reset.** `roster-browser.tsx:246-251` holds **six** filters - `location`, `program`, `level`, `grade`, `payment`, `engagement`. Resetting four of six would leave the button visibly failing to reset while `isDefault` reads true. Task 8 resets all six. **The spec has been corrected to match.**
2. **`/welcome/visitors` coordinator access is out of scope.** P1 v2 deliberately does not grant it (the route did not exist when P1 was written). `/welcome/visitors` falls to `can-access-route.ts:112` and welcome-team gets it for free; a coordinator does not. If coordinator access is wanted it is one path added to P1 v2 Task 4 Step 6's clause. **Task 6 must not assume P1 landed.**
3. **`guest_check_ins.date` keeps its calendar-day meaning.** v1 justified the dual-write as protecting "the admin reports that read it". That is false - `date` has exactly **one** reader in the repo, `check-in-attendance.ts:172`, which this plan moves off it. The dual-write is still right, for the real reasons: it is non-destructive to existing docs and `date` preserves the actual day the guest walked in, which `sessionDate` erases. Task 2 says so in the comment so nobody later assumes `date` is load-bearing.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/portal/src/features/setu/teacher/roster-confirmation.ts:77` | fid resolution for top-level donation docs | 1 |
| `apps/portal/src/features/setu/calendar/calendar.ts` | new `sessionDateFor(ymd)` - the single date-normalization seam | 2 |
| `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts:33-45` | dual-write `date` + `sessionDate` | 2 |
| `apps/portal/src/features/setu/attendance/check-in-attendance.ts:168-173` | query `sessionDate` | 2 |
| `apps/portal/src/features/setu/teacher/visitors.ts:59-63` | normalize the caller's date | 2 |
| `apps/portal/scripts/backfill-guest-session-date.ts` | one-shot, re-runnable backfill | 2 |
| `apps/portal/src/features/setu/teacher/attendance-detail.ts` | parent contact + donation status for a level's fids | 3 |
| `apps/portal/src/features/setu/teacher/roster.ts:37,92,144-152` | carry `foodAllergies`; widen `enrMetaByFid` with the amount fields | 3, 4 |
| `apps/portal/src/features/setu/teacher/level-attendance-view.ts:7-17` | widen `AttendanceViewRow` | 4 |
| `apps/portal/docs/MOBILE_API_CHANGELOG.md` | response-shape entry | 4 |
| `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` | row restructure + table/card layouts + drawer | 5 |
| `apps/portal/src/app/welcome/visitors/page.tsx` | welcome-team visitors surface | 6 |
| `apps/portal/src/features/family/components/desktop-sidebar.tsx` + `welcome-mobile-nav.tsx` | Visitors nav link | 6 |
| `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx:8-10,89` | grade filter (mind the existing local `VisitorRow` and `grade` state) | 7 |
| `apps/portal/src/features/setu/roster/roster-browser.tsx:246-251` | Reset control | 8 |
| `apps/portal/e2e/setu/teacher/guest-to-teacher.spec.ts` | the spec §5.3 gap | 9 |

---

## Task 1: Fix the roster-confirmation `fid` bug

**The bug is real and verified.** `donations` is a **top-level** collection (`create-donation.ts:28` `db.collection('donations').doc()`; `get-donations.ts:29` queries it with `.where('fid','==',fid)`). So for every donation doc, `d.ref.parent.parent` is `null` and `roster-confirmation.ts:77`'s `d.ref.parent.parent?.id` yields `undefined`, making `:78` `continue` on **every** donation. Completed-donation confirmation never fires on the teacher roster.

Three other readers already do it correctly, with the identical defensive pattern:
- `features/setu/reports/enrollment-report.ts:178`
- `features/setu/roster/report-dataset.ts:111`
- `features/setu/roster/build-csv-rows.ts:78`

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/roster-confirmation.ts:77`
- Test: `apps/portal/src/features/setu/teacher/__tests__/roster-confirmation.test.ts`

**Interfaces:**
- Produces: no signature change. `deriveConfirmedFidsForLevel(db, pid, enrollments)` keeps its three-argument shape.

- [ ] **Step 1: Write the failing test**

The existing suite passes today **while production is broken**, and the reason is instructive: `fakeDb({ attendance, paymentSource, donationsByFid })` (`__tests__/roster-confirmation.test.ts:14-37`) builds donation docs whose `ref.parent.parent.id` is populated and whose `data()` carries **no `fid` field** - the exact inverse of the real shape. The new test must reproduce the real shape.

```ts
it('confirms a family from a TOP-LEVEL donation doc (fid in data, no parent doc)', async () => {
  // Real shape: donations live at /donations/{did} with an `fid` field, so
  // ref.parent.parent is null. The pre-existing fixture had it backwards, which
  // is why this suite stayed green while the teacher roster never confirmed.
  const db = fakeDbWithTopLevelDonation({
    fid: 'CMT-FAM-01',
    donation: { status: 'completed', amountCAD: 200, fid: 'CMT-FAM-01' },
  });
  const confirmed = await deriveConfirmedFidsForLevel(db, 'bala-vihar-2026-27', [
    { fid: 'CMT-FAM-01', /* ...the LevelEnrollment fields the helper reads... */ },
  ]);
  expect(confirmed.has('CMT-FAM-01')).toBe(true);
});
```

Note the signature: **three** arguments, `(db, pid, enrollments)`. Extend the existing `fakeDb` helper with a variant whose donation docs expose `ref.parent.parent === null` and carry `fid` in `data()`; do not invent `seedEnrollment`/`seedDonation` helpers, this file has none.

Only the legacy-payment-source path reads donations (`if (needsRead.length > 0)` guards the scan), so the fixture's enrollment must have a legacy payment source or the scan never runs and the test passes vacuously. Check what `paymentSourceOf` returns for the fixture before asserting.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/roster-confirmation.test.ts --project node
```

Expected: FAIL - `confirmed.has('CMT-FAM-01')` is `false`.

- [ ] **Step 3: Apply the same defensive read the other three use**

`roster-confirmation.ts:77`:

```ts
      // donations is a TOP-LEVEL collection with an `fid` field, so
      // ref.parent.parent is null for every doc. Prefer the field and keep the
      // parent-path fallback for any legacy subcollection docs. Same pattern as
      // enrollment-report.ts:178, report-dataset.ts:111, build-csv-rows.ts:78.
      const fid = typeof (data as { fid?: unknown }).fid === 'string'
        ? (data as { fid: string }).fid
        : d.ref.parent.parent?.id;
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher --project node
```

Expected: PASS, with every pre-existing test in the directory still green.

- [ ] **Step 5: Verify against deployed UAT**

Open a level whose families have completed donations and confirm the confirmation state now appears. A unit test with a corrected fixture proves the code; only real data proves the fixture was corrected the right way.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/teacher/roster-confirmation.ts \
  apps/portal/src/features/setu/teacher/__tests__/roster-confirmation.test.ts
git commit -m "fix(teacher): resolve donation fid from the field, not the parent path

donations is a top-level collection with an fid field (create-donation.ts:28),
so d.ref.parent.parent is null for every doc and roster-confirmation.ts:77
resolved undefined, continuing past EVERY donation. Completed-donation
confirmation has never fired on the teacher roster.

Three other readers already do this correctly (enrollment-report.ts:178,
report-dataset.ts:111, build-csv-rows.ts:78); this adopts the same pattern.

The existing test suite passed throughout, because its fixture built donation
docs with a populated parent path and no fid field - the exact inverse of the
real shape. The new test reproduces the real shape, which is the part that
actually needed fixing."
```

---

## Task 2: Fix the guest date-key mismatch

**The bug is real and verified.** The writer stamps `date: torontoYMD()` - the actual calendar day (`guest-check-ins.ts:41`). The teacher visitors page defaults its `?date=` to `mostRecentSunday()` (`app/teacher/levels/[levelId]/visitors/page.tsx:26`). A guest who checks in on a Sunday matches; a guest who checks in midweek is invisible on the Sunday view. The precedent for the fix is already in the repo: `features/setu/check-in/mark-door-attendance.ts:63-64` normalizes to `mostRecentSunday(now)` with a comment saying exactly why.

**One helper, three call sites.** The writer, the reader's caller, and the backfill must all compute the same Sunday. v1 spread that logic across three places and got it wrong in one of them, a full week off. A single exported function removes the possibility.

**Files:**
- Modify: `apps/portal/src/features/setu/calendar/calendar.ts` (add `sessionDateFor`)
- Modify: `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts:33-45`
- Modify: `apps/portal/src/features/setu/attendance/check-in-attendance.ts:168-173`
- Modify: `apps/portal/src/features/setu/teacher/visitors.ts:59-63` - **the sole caller, and v1 never touched it**
- Create: `apps/portal/scripts/backfill-guest-session-date.ts`
- Test: `apps/portal/src/features/setu/calendar/__tests__/calendar.test.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/visitors.test.ts`

**Interfaces:**
- Produces: `sessionDateFor(ymd: string): string` - maps a `YYYY-MM-DD` to the Sunday that starts its week, in Toronto terms.

- [ ] **Step 1: Write the failing test for the date helper**

This is the test that catches the week-off bug. Without it, the backfill silently writes wrong Sundays into UAT and then prod.

```ts
describe('sessionDateFor', () => {
  it('maps a Sunday to itself', () => {
    expect(sessionDateFor('2026-09-06')).toBe('2026-09-06');
  });

  it('maps a midweek day back to the preceding Sunday', () => {
    expect(sessionDateFor('2026-09-09')).toBe('2026-09-06');
  });

  it('maps a Saturday back to the preceding Sunday', () => {
    expect(sessionDateFor('2026-09-12')).toBe('2026-09-06');
  });

  it('does not drift a week on a plain date string', () => {
    // The trap: mostRecentSunday(new Date('2026-09-06')) returns 2026-08-30.
    // new Date('YYYY-MM-DD') is UTC midnight, which torontoToday() formats as
    // the PREVIOUS day in Toronto, so the Sunday lands a full week early.
    expect(sessionDateFor('2026-09-06')).not.toBe('2026-08-30');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/calendar --project node
```

Expected: FAIL - `sessionDateFor` is not exported.

- [ ] **Step 3: Add the helper**

In `calendar.ts`, beside `mostRecentSunday`:

```ts
/**
 * The Sunday that starts the week containing `ymd`, as a Toronto YYYY-MM-DD.
 * Returns `ymd` unchanged when it is already a Sunday.
 *
 * The noon-UTC anchor is load-bearing. `new Date('2026-09-06')` is UTC
 * midnight, which torontoToday() formats as '2026-09-05' (the previous
 * evening, EDT), so mostRecentSunday would return the Sunday a WEEK earlier.
 * Same anchor as mostRecentSunday's own internals at :42.
 *
 * One helper, three call sites: the guest writer, the visitors reader's
 * caller, and the backfill. They must never disagree.
 */
export function sessionDateFor(ymd: string): string {
  return mostRecentSunday(new Date(`${ymd}T12:00:00Z`));
}
```

- [ ] **Step 4: Dual-write on the guest check-in**

`guest-check-ins.ts`, inside `recordGuestCheckIn`:

```ts
    // `date` is the actual Toronto calendar day the guest walked in. It is kept
    // for forensic value and because rewriting existing docs would destroy it -
    // but note it has NO reader after this change (the only one was
    // check-in-attendance.ts:172, which now reads sessionDate). Do not assume
    // it is load-bearing.
    date: torontoYMD(),
    // `sessionDate` is the Sunday teachers actually view. A midweek guest was
    // previously invisible on the Sunday visitors panel.
    sessionDate: sessionDateFor(torontoYMD()),
    checkedInAt: new Date().toISOString(),
```

- [ ] **Step 5: Read `sessionDate`, and normalize at the caller**

`check-in-attendance.ts:172` - swap the field and rename the parameter to `sessionDate` so the contract is visible at the call site:

```ts
export async function readPortalGuestChildren(sessionDate: string): Promise<DoorGuestChild[]> {
  // ...
    const snap = await db.collection('guest_check_ins').where('sessionDate', '==', sessionDate).get();
```

Single-field equality on a top-level collection is auto-indexed. No composite index, no `firestore.indexes.json` change.

**Then fix the caller, which v1 never touched.** `visitors.ts:59-63` passes its own `date` straight through to both readers, and that `date` is a **user-supplied, unnormalized** `?date=` validated only by `/^\d{4}-\d{2}-\d{2}$/` (`teacher/levels/[levelId]/visitors/page.tsx:26`). Without this edit, any non-Sunday `?date=` matches nothing - trading "midweek guests invisible on the Sunday view" for "midweek guests invisible on the midweek view":

```ts
  const [legacyDoor, portalDoor, confirmed] = await Promise.all([
    readDoorGuestCheckIns(date),
    // Guest docs are keyed to the week's Sunday, so a midweek ?date= must be
    // normalized or it matches nothing. The legacy door reader still takes the
    // raw calendar date - it has its own key.
    readPortalGuestChildren(sessionDateFor(date)),
    listGuestsDetailed(levelId, date),
  ]);
```

- [ ] **Step 6: Write the caller test**

```ts
it('surfaces a guest whose sessionDate is the preceding Sunday when the view asks for a Wednesday', async () => {
  // Seed guest_check_ins with sessionDate: '2026-09-06'
  const view = await getLevelVisitorsView('brampton-level-2', '2026-09-09');
  expect(view!.visitors.map((v) => v.name)).toContain('Guest Child');
});
```

- [ ] **Step 7: Write the backfill script**

`apps/portal/scripts/backfill-guest-session-date.ts`. Requirements:

- Reads every `guest_check_ins` doc; for each, computes `sessionDateFor(doc.date)`.
- **Idempotent by default:** skips docs that already have `sessionDate`.
- **`--recompute` flag that overwrites an existing `sessionDate`.** Non-negotiable: this is a one-shot write against real data, and without a recompute path a bad run is unrecoverable. v1 had no such flag and would have baked in a week-off error permanently.
- `--dry-run` prints the mapping and writes nothing. Run this first, every time.
- `--limit N` for a bounded first pass.
- Refuses to run unless `PORTAL_FIREBASE_PROJECT_ID` is the UAT project, unless `--allow-prod` is passed.
- A `pnpm` alias with `tsx --env-file=.env.local`, per the repo rule that every CLI ops script gets one.

Follow the shape of `apps/portal/scripts/migrate-legacy-families.ts`, which already has the dry-run / limit / allow-prod pattern.

- [ ] **Step 8: Dry-run, then run against UAT**

```bash
pnpm --filter @cmt/portal backfill:guest-session-date -- --dry-run
```

Read the output. Spot-check that a doc with `date: '2026-09-06'` (a Sunday) maps to `sessionDate: '2026-09-06'` and **not** `'2026-08-30'`. Then run for real without `--dry-run`.

- [ ] **Step 9: Run the tests and update the runbook**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu --project node
```

New script and a new field on an existing collection, so `docs/runbooks/production-cutover-checklist.md` needs: §3 (the `sessionDate` field on `guest_check_ins`), §10 (the script), and a dated §14 entry with the prod-cutover TODO to run the backfill there.

- [ ] **Step 10: Commit**

```bash
git add apps/portal/src/features/setu/calendar apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts \
  apps/portal/src/features/setu/attendance/check-in-attendance.ts \
  apps/portal/src/features/setu/teacher/visitors.ts \
  apps/portal/scripts/backfill-guest-session-date.ts \
  apps/portal/package.json docs/runbooks/production-cutover-checklist.md
git commit -m "fix(visitors): key guest check-ins to the session Sunday teachers view

The writer stamped the actual calendar day; the teacher visitors page defaults
to mostRecentSunday(). A guest who checked in midweek was invisible to
teachers. Same normalization mark-door-attendance.ts:63-64 already does.

Dual-write: `date` keeps the real walk-in day (non-destructive, and it is the
only record of when they actually came), `sessionDate` is what the query uses.
Note in the code that `date` now has NO reader - its only one was
check-in-attendance.ts:172, which this moves.

One exported sessionDateFor(ymd) rather than three inline computations. The
noon-UTC anchor inside it is the whole point: new Date('2026-09-06') is UTC
midnight, which torontoToday() reads as the previous evening in Toronto, so
the naive form returns a Sunday a full WEEK early. A test pins it.

The caller is fixed too. visitors.ts:59-63 passes an unnormalized, user-
supplied ?date= to both readers; swapping the stored field without normalizing
there would just move the invisibility from Sunday to midweek.

The backfill takes --recompute, not just --dry-run/--limit: it writes real
data once, and a bad run with only skip-if-present idempotence is unrecoverable."
```

---

## Task 3: Parent contact and donation status for a level's students

Spec §4.4 wants parent contact and payment status on the attendance screen. Neither is in `level-attendance-view.ts:7-17` today.

**Read budget: bounded and index-free.** v1 proposed three unfiltered `collectionGroup` scans on the eager render (~2,500 members + ~870 enrollments + all donations, forever-growing), duplicating a donations scan `deriveConfirmedFidsForLevel` already performs in the same request, and moving `grade-eligible.ts`'s deliberately **lazy** ~2,500-doc scan onto the eager path. This route is hit by every teacher, on every level, every Sunday morning. Do none of that. Instead:

- **Enrollments: zero new reads.** `deriveRoster` already reads them and builds `enrMetaByFid` (`roster.ts:144`). Widen that map to carry the amount fields it currently discards at `:146`.
- **Donations: chunked `in` queries on the level's fids, not a collectionGroup scan.** `donations` is top-level with an `fid` field, so `db.collection('donations').where('fid','in',chunk)` works directly. Chunk at 30 (Firestore's `in` cap), so a 40-family level is two queries. Filter `status === 'completed'` **in memory** - adding it as a second `where` would make it a multi-`where` needing a composite index this plan otherwise does not need.
- **Offerings: one batched `getAll`.** Typically exactly one `oid` per level.
- **Contacts: bounded parallel subcollection reads** over the level's fids, the same shape as `student-detail.ts:62`. This is **level-scoped (20-40 families), not roster-scoped (867)** - the anti-fan-out rule targets the latter. Say so in a comment and cap it.

**Files:**
- Create: `apps/portal/src/features/setu/teacher/attendance-detail.ts`
- Modify: `apps/portal/src/features/setu/teacher/roster.ts:144-152` (widen `enrMetaByFid`), and expose it on `RosterResult`
- Test: `apps/portal/src/features/setu/teacher/__tests__/attendance-detail.test.ts`

**Interfaces:**
- Consumes: `resolveSuggestedAmount` from `@cmt/shared-domain`; `enrMetaByFid` from `deriveRoster`
- Produces:
  ```ts
  export interface AttendanceDetail {
    parentName: string | null;
    parentPhone: string | null;
    parentEmail: string | null;
    donationComplete: boolean;
  }
  export async function buildAttendanceDetailIndex(
    db: FirebaseFirestore.Firestore,
    fids: string[],
    enrMeta: Map<string, { oid: string; enrolledAt: string; suggestedAmountOverride: number | null; suggestedAmountSnapshot: number | null }>,
  ): Promise<Map<string, AttendanceDetail>>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('marks a family complete when completed donations meet the expected amount', async () => { /* ... */ });

it('ignores non-completed donations', async () => { /* ... */ });

it('uses the LIVE offering amount, not the enrollment snapshot', async () => {
  // Every other payment surface resolves the live amount:
  //   build-csv-rows.ts:115, report-dataset.ts:180, get-enrollments.ts:87
  //   all do `override ?? resolveSuggestedAmount(offering, enrolledAt) ?? snapshot`
  // Using the snapshot here would make the teacher's chip disagree with the
  // welcome roster's chip for the same family after a pricing-tier change.
  // Seed: snapshot = 100, live tier = 200, donated = 150.
  const idx = await buildAttendanceDetailIndex(db, ['CMT-FAM-01'], enrMeta);
  expect(idx.get('CMT-FAM-01')!.donationComplete).toBe(false); // 150 < 200
});

it('prefers suggestedAmountOverride over both', async () => { /* ... */ });

it('reads donations in chunks of 30 fids', async () => {
  // Guards the Firestore `in` cap. Seed 65 fids, assert 3 queries.
});

it('returns a null parent when a family has no manager adult', async () => { /* ... */ });
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/attendance-detail.test.ts --project node
```

Expected: FAIL - module not found.

- [ ] **Step 3: Widen `enrMetaByFid` in `roster.ts`**

At `:146`, the destructure currently drops the amount fields. Add them, and add `enrolledAt`:

```ts
    const e = d.data() as {
      fid?: string; location?: string; enrolledMids?: string[]; eid?: string; oid?: string;
      enrolledVia?: LevelEnrollment['enrolledVia'];
      enrolledAt?: string;
      suggestedAmountOverride?: number | null;
      suggestedAmountSnapshot?: number | null;
    };
```

Carry them into the `enrMetaByFid.set(...)` at `:152` and expose the map on `RosterResult`. **Zero extra reads** - these fields are already in the documents being read.

- [ ] **Step 4: Implement `attendance-detail.ts`**

```ts
import 'server-only';
import { resolveSuggestedAmount, type OfferingDoc } from '@cmt/shared-domain';

const IN_CHUNK = 30; // Firestore `in` operator cap.

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function buildAttendanceDetailIndex(db, fids, enrMeta) {
  const out = new Map<string, AttendanceDetail>();
  if (fids.length === 0) return out;

  // Donations: `donations` is TOP-LEVEL with an `fid` field, so the level's
  // fids can be queried directly. Chunked `in` (cap 30) rather than a
  // collectionGroup scan, which would grow forever and is already performed
  // once this request by deriveConfirmedFidsForLevel. Status is filtered in
  // memory on purpose: a second `where` would need a composite index.
  const donSnaps = await Promise.all(
    chunk(fids, IN_CHUNK).map((c) => db.collection('donations').where('fid', 'in', c).get()),
  );

  // Offerings: one batched getAll. Typically exactly one oid per level.
  const oids = [...new Set([...enrMeta.values()].map((m) => m.oid))];
  const offSnaps = oids.length > 0
    ? await db.getAll(...oids.map((oid) => db.collection('offerings').doc(oid)))
    : [];

  // Contacts: bounded parallel subcollection reads. This fid set is
  // LEVEL-scoped (typically 20-40 families), NOT roster-scoped (867). The
  // anti-fan-out rule targets the latter; student-detail.ts:62 reads one
  // family's members exactly this way for exactly this data.
  const memSnaps = await Promise.all(
    fids.map((fid) => db.collection('families').doc(fid).collection('members').get()),
  );

  // ... join in memory: expected = override ?? resolveSuggestedAmount(offering, enrolledAt) ?? snapshot
  return out;
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher --project node
```

- [ ] **Step 6: Confirm no new index is needed**

Every query here is a single-field equality (`fid in [...]`), a document `getAll`, or a subcollection `get`. All auto-indexed. **If you added a second `where`, remove it** - `firestore.indexes.json` must not change in this task.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/teacher/attendance-detail.ts \
  apps/portal/src/features/setu/teacher/roster.ts \
  apps/portal/src/features/setu/teacher/__tests__
git commit -m "feat(teacher): parent contact and donation status for a level's students

Bounded and index-free. Enrollments cost zero new reads - deriveRoster already
loads them and enrMetaByFid just stopped discarding the amount fields.
Donations use chunked `in` queries on the level's fids (donations is top-level
with an fid field), not a collectionGroup scan that grows forever and is
already run once per request by deriveConfirmedFidsForLevel. Contacts are a
level-scoped parallel subcollection read, 20-40 families, the same shape
student-detail.ts:62 uses - not the roster-scoped fan-out the rule forbids.

The expected amount resolves the LIVE offering via resolveSuggestedAmount,
matching build-csv-rows.ts:115, report-dataset.ts:180 and get-enrollments.ts:87.
Using the enrollment snapshot would make a teacher's chip disagree with the
welcome roster's chip for the same family after any pricing-tier change."
```

---

## Task 4: Widen the attendance view model

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/level-attendance-view.ts:7-17`
- Modify: `apps/portal/src/features/setu/teacher/roster.ts:37,92` - **`safetyNotes` cannot be populated without this.** `getLevelAttendanceView` maps from `RosterMember`, which carries only `hasSafetyInfo: boolean`; the underlying `foodAllergies` text is collapsed to a boolean at `:92` and discarded. `RosterMemberInput.foodAllergies` exists at `:12` but never reaches `RosterMember`.
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`
- Test: `apps/portal/src/features/setu/teacher/__tests__/level-attendance-view.test.ts`, `roster.test.ts`

- [ ] **Step 1: Write the failing tests**

Assert `AttendanceViewRow` carries `parentName`, `parentPhone`, `parentEmail`, `donationComplete`, `safetyNotes`, and that `buildRoster` now carries `foodAllergies` through while `hasSafetyInfo` stays the derived boolean so nothing downstream breaks.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 2b: Check the blast radius before widening the shared types**

`RosterMember` and `RosterResult` are contained - both are referenced only inside `roster.ts` and its tests, so widening them is purely additive at the type level. `AttendanceViewRow` reaches `level-attendance-view.ts` and `attendance-marker.tsx:6,16` only.

But `deriveRoster` itself has **six** callers, and one of them is not a teacher surface:

| Caller | Surface |
|---|---|
| `features/setu/teacher/level-attendance-view.ts:52` | teacher attendance (this plan) |
| `features/setu/teacher/save-attendance.ts:28` | teacher save path |
| `features/setu/teacher/confirm-previous.ts:23` | teacher confirm path |
| `features/setu/teacher/student-detail.ts:48` | teacher student profile |
| **`app/welcome/levels/[levelId]/page.tsx:32`** | **welcome-team level roster** |

Nothing breaks - the additions are optional-by-omission. **But decide deliberately whether allergy free-text should reach the welcome-team level page.** Spec §4.6's privacy decision covers teachers seeing contact and donation status; it says nothing about welcome-team volunteers seeing medical text. If the answer is no, that page must not render `foodAllergies`, and a test should pin that. Record the decision either way.

- [ ] **Step 3: Carry `foodAllergies` through `RosterMember`**

Add `foodAllergies: string | null` to the `RosterMember` interface (`:37`) and set it in `buildRoster` (`:92`) alongside the existing derived boolean:

```ts
        foodAllergies: m.foodAllergies ?? null,
        hasSafetyInfo: Boolean(m.foodAllergies && m.foodAllergies.trim().length > 0),
```

- [ ] **Step 4: Widen `AttendanceViewRow` and populate it**

Join `buildAttendanceDetailIndex`'s output by `fid` in `getLevelAttendanceView`, and map `safetyNotes` from `m.foodAllergies`.

- [ ] **Step 5: Write the MOBILE_API_CHANGELOG entry**

`GET /api/setu/teacher/levels/[levelId]/roster` returns `{ view }` verbatim (`route.ts:24-26`), so this **is** a `/api/setu/**` response-shape change and the entry is mandatory. State the new fields and that they are additive (no mobile change required to keep working).

**Call out the privacy delta explicitly in the entry and in the commit.** Allergy free-text now ships to every client rendering a level roster, where today only a boolean does. Spec §4.6 recorded the decision for contact and donation status; medical text was not part of it. If that is not wanted on mobile, the route should project a narrower shape than the server component uses - decide now, not after it ships.

- [ ] **Step 6: Run the tests, then commit**

```bash
git add apps/portal/src/features/setu/teacher apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(teacher): parent contact, donation status and safety notes on the attendance row

roster.ts had to change too: RosterMember carried only hasSafetyInfo (a
boolean), with the foodAllergies text collapsed at :92 and discarded, so
safetyNotes could not have been populated from level-attendance-view alone.

MOBILE_API_CHANGELOG entry included - /api/setu/teacher/levels/[levelId]/roster
returns { view } verbatim, so widening AttendanceViewRow is a response-shape
change.

Privacy delta, stated deliberately: allergy free-text now reaches every client
rendering a level roster, where previously only a boolean did. Spec 4.6 covered
parent contact and donation status; medical text was not in that decision."
```

---

## Task 5: Rebuild the attendance UI

Spec §4.1-4.3. Desktop table, mobile cards, detail drawer, stat cards, filter chips, footer bar.

**The row restructure is the risky part.** Rows are `<button>` elements today (`attendance-marker.tsx:509`, spanning `:505-580`), which makes a nested `View profile` link invalid HTML. Spec §4.5: the row becomes a plain container, the toggle is a button, `View profile` is a link.

Two things that restructure must preserve, neither of which v1 stated:
1. **The container must not carry `role="button"`** - that reintroduces the nesting violation it exists to fix.
2. **`aria-pressed` moves from the row onto the toggle**, so keyboard users reach the toggle and the link independently. Without this the restructure is an accessibility **regression** from today's single `aria-pressed` row.

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx`
- Modify: `apps/portal/src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx` - **migration, not just additions**

- [ ] **Step 1: Migrate the existing test suite FIRST, and enumerate what changes**

Do this before writing new tests, or you cannot tell an intended failure from a regression. The existing `row(name)` helper is:

```ts
function row(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}
```

(`__tests__/attendance-marker.test.tsx:27-29`), used across ~10 assertions (`aria-pressed`, `within(row(...))`, tap-to-toggle). Replacing the row `<button>` with a container **breaks every one of them**.

Rewrite the helper to find the row container by test id and student name, then reach the toggle inside it:

```ts
function row(name: string): HTMLElement {
  const rows = screen.getAllByTestId('att-row');
  const found = rows.find((r) => new RegExp(name, 'i').test(r.textContent ?? ''));
  if (!found) throw new Error(`no attendance row for ${name}`);
  return found;
}

function toggle(name: string): HTMLElement {
  return within(row(name)).getByRole('button', { name: /present|not marked/i });
}
```

List, in the commit, which existing tests changed shape and which are unchanged.

- [ ] **Step 2: Write the new failing tests**

**Assert against the fetch body, not a callback.** `AttendanceMarker` has **no `onMark` prop** (`attendance-marker.tsx:9-26`) - it owns attendance state internally and persists through a debounced `fetch('/api/setu/teacher/attendance', ...)` (`:211-235`). The existing suite already asserts on `lastFetchBody()` (`:31-36`). Do not introduce `onMark`; the debounce and beacon logic at `:263-280` is why that state is internal.

**Use `getAllBy*` and act on every match.** The plan specifies a desktop table plus an `md:hidden` mobile card list. jsdom applies no media queries, so both branches mount, every element appears twice, and each owns independent state.

```ts
it('renders the parent contact and a View profile link on each row', () => {
  render(<AttendanceMarker {...props} />);
  // Both responsive branches mount in jsdom - repo convention is getAllBy* + length.
  expect(screen.getAllByText('Vaibhav Rana').length).toBeGreaterThan(0);
  const links = screen.getAllByRole('link', { name: /view profile/i });
  expect(links.length).toBeGreaterThan(0);
  expect(links[0]).toHaveAttribute('href', '/teacher/students/CMT-A-03');
});

it('marking present posts the mid, and clicking the link does not toggle', async () => {
  render(<AttendanceMarker {...props} />);
  await userEvent.click(toggle('Vaibhav Rana'));
  expect(lastFetchBody().marks['CMT-A-03']).toBe('present');
});
```

**Do not select rows with `getAllByRole('button', { name: /mark/i })[0]`.** In DOM order `/mark/i` matches the `Unmarked {n}` filter pill (`:486-488`) and the `Mark all present` button (`:490-496`) **before** any row, and a present row's `aria-label` is `"... - present"`, which does not match `/mark/i` at all.

- [ ] **Step 3: Restructure the row**

Container is a `<div>`/`<tr>` with `data-testid="att-row"` and **no** `role`. Inside it: the toggle `<button>` carrying `aria-pressed` and an accessible name, and the `View profile` `<a>`. Tap-to-mark stays on the container's `onClick`, which must early-return when the click originated inside a link or the toggle:

```tsx
onClick={(e) => {
  if ((e.target as HTMLElement).closest('a,button')) return;
  toggle(r.mid);
}}
```

- [ ] **Step 4: Build the rest of §4.1-4.3**

Stat cards, info banner, search + filter chips with counts, `Mark all present`, the desktop table columns, the mobile card list, the detail drawer (Attendance / Registration / Primary Parent / Actions / Note), and the footer bar. Keep the existing safety dot and give it an accessible label (§4.3) - it is a bare visual today. The drawer gets a `Safety & medical` block rendering `safetyNotes` as text.

- [ ] **Step 5: Run the full component suite**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher --project jsdom
```

Every pre-existing assertion must pass in its migrated form. A test you had to delete rather than migrate is a behaviour change - justify it or fix it.

- [ ] **Step 6: Verify against deployed UAT**

Sign in as the teacher persona, open a level with **at least two** students, and check: contact renders, donation chip matches the welcome roster's chip for the same family, `View profile` navigates without toggling attendance, tapping the row marks present, the mark survives a reload, and the mobile viewport renders cards. Then keyboard-only: Tab must reach the toggle and the link independently.

- [ ] **Step 7: Commit**

---

## Task 6: `/welcome/visitors`

**Files:**
- Create: `apps/portal/src/app/welcome/visitors/page.tsx`
- Modify: `apps/portal/src/features/family/components/desktop-sidebar.tsx` (`WELCOME_NAV_ITEMS`) and `welcome-mobile-nav.tsx`
- Test: page test + the E2E in Task 9

**Read pattern - one reading only.** v1's Architecture line said "reuses `getLevelVisitorsView` across levels" while its Step 3 said to read the enabled levels once and group by level. **Step 3 is correct**; calling `getLevelVisitorsView` per level multiplies a genuine per-family fan-out by the level count - `readDoorGuestCheckIns` lists every `guest-families` doc and point-reads `checkIns/{date}` for each (`check-in-attendance.ts:113-153`), plus a `contactKeys` get per matched child (`visitors.ts:72`) and a `listGuestsDetailed` per level.

Read the enabled levels once with the existing `fetchEnabledLevelsForPid(oid)` (`derive-child-level.ts:36`, already used at `mark-door-attendance.ts:59`) - do not write a new levels read - then group the date's guest children by level with the existing `guestMatchesLevel` predicate (`visitors.ts:15-23`).

**Access.** `/welcome/visitors` falls to `can-access-route.ts:112` and welcome-team gets it with **no new clause**. Do not add one. **Do not assume P1 landed** - P1 v2 deliberately does not grant this path to a coordinator, so scope the access test to welcome-team and admin only. If coordinator access is wanted later it is one path added to P1 v2 Task 4 Step 6.

**Nav.** P1 v2 does **not** add a Visitors nav link (visitors was removed from P1's scope). This task owns it, or welcome-team gets an unreachable page - which is requirement 1 in spec §0.

- [ ] **Step 1: Write the failing page test**
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement the page** (levels once, group in memory, per the read pattern above)
- [ ] **Step 4: Add the nav entries** to `WELCOME_NAV_ITEMS` and `welcome-mobile-nav.tsx`
- [ ] **Step 5: Run the tests**
- [ ] **Step 6: Commit**

---

## Task 7: Visitor grade filter

Spec §5.4. Client-side only - `VisitorRow` already carries `grade` (`visitors.ts:25-32`) and `getLevelVisitorsView` already grade-matches to the level. No new read, no index.

**Two collisions to avoid** in `visitors-panel.tsx`:
- It already declares `const [grade, setGrade] = useState('')` at `:89` for the **add-visitor** form (used at `:149`, `:277`). Name the filter state something else - `gradeFilter`.
- It declares its **own local** `interface VisitorRow` at `:8-10`; it does not import the shared type from `visitors.ts`. Either import the shared one or leave the local one alone deliberately - do not assume they are the same type.

- [ ] **Step 1: Write the failing test** (remember `getAllBy*` if this panel has responsive branches)
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Add the `gradeFilter` state and the control**
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit**

---

## Task 8: Roster Reset button

Spec §6, **as corrected**. `roster-browser.tsx:246-251` holds **six** filters. Reset restores:

| Filter | Reset to |
|---|---|
| `payment` | `'paid'` |
| `engagement` | `'enrolled'` |
| `location` | `null` |
| `program` | `null` |
| `level` | `null` |
| `grade` | `null` |
| search text | `''` |

`level` and `grade` are in that list because spec §6 omitted them and v1 inherited the omission - without them Reset visibly fails to reset while `isDefault` reads true. **`?year=` is deliberately untouched**: the school year is a scope in a separate bar, not a filter chip, and resetting it would silently move the user to a different year's data.

The control is hidden or disabled when the filters are already at their defaults, so it never reads as a live control that does nothing.

- [ ] **Step 1: Write the failing tests**

`RosterBrowser` renders both responsive branches with **independent state**. Every assertion uses `getAllBy*`, and every interaction acts on **all** matches, or clicking one Reset leaves the other branch's filters set. Follow `clearDefaultFilters()` at `roster-browser.test.tsx:55-60`.

```ts
it('reset restores all six filters and clears search', async () => {
  render(<RosterBrowser {...props} />);
  // set every filter away from its default, on BOTH branches
  for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) await userEvent.selectOptions(sel, '');
  // ... and location / program / level / grade / engagement, plus search text
  for (const btn of screen.getAllByRole('button', { name: /reset/i })) await userEvent.click(btn);
  for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) expect(sel).toHaveValue('paid');
  for (const sel of screen.getAllByRole('combobox', { name: 'Level' })) expect(sel).toHaveValue('');
  for (const sel of screen.getAllByRole('combobox', { name: 'Grade' })) expect(sel).toHaveValue('');
});

it('hides Reset when the filters are already at their defaults', () => {
  render(<RosterBrowser {...props} />);
  expect(screen.queryAllByRole('button', { name: /reset/i })).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement Reset and `isDefault` over all six filters plus search**
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit**

---

## Task 9: The guest→teacher E2E

Spec §5.3, and the gap named at `e2e/legacy/b1-kiosk.spec.ts:22`. **v1's self-review marked this ✅ against an attendance E2E that never submits the guest form.** A false tick on a spec line is worse than an open gap.

Also required by CLAUDE.md pre-ship rule 7: `/welcome/visitors` is a new user-facing route, and a route with no deployed-UAT E2E is untested - the rule exists because `/family/seva` shipped with zero E2E and 500'd in prod.

**Files:**
- Create: `apps/portal/e2e/setu/teacher/guest-to-teacher.spec.ts`
- Create: `apps/portal/e2e/setu/admin/welcome-visitors.spec.ts`

- [ ] **Step 1: Write the UI→UI guest→teacher spec**

Against **deployed** UAT. Submit the real guest form (`guest-check-in-form.tsx`) with a child name and grade and the required parent email and phone, then sign in as the teacher persona, open the level matching that grade, and assert the child appears in the visitors panel. This is the flow Task 2's date-key fix exists to make work, so it is also Task 2's real acceptance test.

- [ ] **Step 2: Write the `/welcome/visitors` spec**

Two guest families across two levels, so the grouping is exercised with N=2 rather than a single-row fixture.

- [ ] **Step 3: Run against deployed UAT**

```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu guest-to-teacher welcome-visitors
```

Password sign-in, never OTP. Never run the whole setu suite - the OTP limiter cascades.

- [ ] **Step 4: Clean up what the specs created**

Guest check-ins written by the spec must be removed, or they accumulate in UAT and pollute every later visitors run.

- [ ] **Step 5: Commit**

---

## Self-review

**Spec coverage.** §4.1-4.2 layouts → Task 5. §4.3 allergies → Tasks 4 (data) + 5 (row label, drawer block). §4.4 data + bulk-read mandate → Task 3. §4.5 row restructure → Task 5 Step 3. §4.6 privacy → recorded, and **extended** in Task 4 Step 5 because allergy free-text was not part of the original decision. §5.1 date defect → Task 2. §5.2 `/welcome/visitors` → Task 6. §5.3 E2E → **Task 9** (v1 marked this covered when it was not). §5.4 grade filter → Task 7. §6 Reset → Task 8, with the spec's own omission of `level`/`grade` corrected.

**Type consistency.** `sessionDateFor(ymd)` is defined in Task 2 and used in the writer, `visitors.ts`, and the backfill. `buildAttendanceDetailIndex(db, fids, enrMeta)` is defined in Task 3 and consumed in Task 4. `AttendanceDetail`'s four fields map onto `AttendanceViewRow`'s new fields plus `safetyNotes`, which comes from `RosterMember.foodAllergies` added in Task 4 Step 3.

**Every review finding is addressed:** C1 → Task 2 Steps 1-3 (one helper, noon-UTC anchor, a test that pins the week-off case) plus `--recompute`. C2 → Task 2 Step 5 (the caller). M1 → Task 3's read budget. M2 → Task 3 Step 1's live-amount test. M3 → Task 4 Step 3. M4 → Task 4 Step 5. M5 → Task 5 Step 2 (fetch body, no `onMark`). M6 → Task 5 Step 1's `row`/`toggle` helpers. M7 → Global Constraints + Tasks 5 and 8. M8 → Task 5 Step 1 (migrate first). M9 → Task 9. m1 → Deviation 3. m2 → Task 1 Step 1. m3 → Task 3 Step 6 (no index, no branch). m4 → Task 8 + the spec. m5 → Task 7. m6 → Task 6's single reading.

**Known risk.** Task 5 is the largest single piece in the whole launch batch - a full UI rebuild of the screen every teacher uses every Sunday, on top of a test suite that must be migrated rather than extended. It is also the most cuttable: Tasks 1, 2, 3, 4 deliver real fixes and real data without it, and the current attendance screen works. If the week compresses, ship 1-4 and 6-9 and let the visual rebuild slip.
