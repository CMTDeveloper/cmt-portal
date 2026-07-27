# P2 v2 - Teacher Attendance, Visitors & Roster

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two live production defects, rebuild the teacher attendance screen to the supplied design, add a welcome-team visitors page with a grade filter, and add a Reset control to the roster.

**Architecture:** Two independent production bug fixes ship first and alone (Tasks 1-2). Then the attendance work (Tasks 3-5), which widens the roster read model with parent contact, donation status and allergy text, then rebuilds the row from a `<button>` into a container with an independent toggle and link. Then visitors (Tasks 6-7), roster reset (Task 8), and the guest→teacher E2E the spec has been missing (Task 9).

**Tech Stack:** Next.js 16 App Router, TypeScript (`exactOptionalPropertyTypes`), Firebase Admin Firestore, Vitest + Testing Library, Playwright.

**Supersedes:** `2026-07-25-launch-p2-teacher-visitors-roster.md`, reviewed as REQUEST CHANGES (2 critical, 9 major, 6 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p2.md`. **Both of v1's headline bug diagnoses were correct and are carried forward unchanged** - the defects were in the fixes and the tests, not the analysis.

**Spec:** `docs/superpowers/specs/2026-07-24-aug-3-launch-batch-design.md` §4, §5, §6.

---

## Global Constraints

- **Bulk reads, never a per-family fan-out over the roster.** Per-family loops time out at ~45s @ 769 families. The rule targets **roster-scoped** loops; a **level-scoped** bounded read (20-40 families) is acceptable. Say which one you are doing, in a comment, every time - and **prove it**, because the obvious fid set is the wrong one:

  > **`deriveRoster`'s `fids` (`roster.ts:154`) is PROGRAM-and-location scoped, not level scoped.** The enrollment scan at `:135-139` filters on `pid` (the offering period for the whole program at a location) and `:147` filters only on `location`. **Level matching happens later and per member**, inside `buildRoster` via `memberMatchesLevel` (`:83`). So `fids` is every family with an active Bala Vihar enrollment at that location - hundreds. The level-scoped set is `[...new Set(roster.members.map((m) => m.fid))]`, derived from the **built** roster.
  >
  > `roster.ts:156-174` is a 19-line comment explaining why the old per-family loop was removed ("~2N calls that made the teacher screens slow"), and `__tests__/roster-fetch.test.ts:126-130` guards it with `expect(fs.perFamilyMemberSubGets).toBe(0)`. Do not reintroduce it.

- **jsdom renders both responsive branches, but "act on every match" is NOT universal.** It applies when the branches are **separate component instances with separate state** - `RosterBrowser` renders `<RosterContent>` twice (`roster-browser.tsx:446-474`), so its filters are genuinely independent. It does **not** apply when one component owns the state for both branches: `AttendanceMarker` has a single `present` map (`attendance-marker.tsx:134`), so acting on both toggles calls `toggle(mid)` twice and **nets zero**. Decide which case you are in before writing the test, and say so.
- **Audit Firestore indexes on any query change.** Fake-firestore is index-blind. This plan is designed to need **zero** new indexes - if you find yourself adding a multi-`where` or a `.where().orderBy()`, stop and re-read the task.
- **jsdom renders BOTH responsive branches.** `block md:hidden` and `hidden md:block` both mount and every element appears twice, so `getBy*` throws - use `getAllBy*`/`findAllBy*`. Documented at `features/setu/roster/__tests__/roster-browser.test.tsx:49-53` and `reports/__tests__/reports-hub.test.tsx:54`. Whether to **act** on every match depends on the state model - see the constraint above.
- **`/api/setu/**` response-shape changes need a `MOBILE_API_CHANGELOG.md` entry** in the same commit (dated, SHA-keyed). `GET /api/setu/teacher/levels/[levelId]/roster` returns `{ view }` verbatim (`route.ts:24-26`), so widening `AttendanceViewRow` **is** such a change.
- **All Firestore work targets `chinmaya-setu-uat`.** Never prod `chinmaya-setu-715b8`, never `--force`.
- **Never parse a `YYYY-MM-DD` with a bare `new Date(ymd)`.** That is UTC midnight, which is the previous evening in Toronto. Always anchor: `new Date(\`${ymd}T12:00:00Z\`)`. This is the C1 defect and the repo already uses the anchor at `calendar.ts:42` and `attendance-marker.tsx:29-33`.
- **No em dashes** in code, comments, commit messages or docs. **Commit author** `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### Ordering

**Tasks 1 and 2 are live production defects and are independent of everything else. Ship them first, alone.** Do not let the attendance rebuild gate them. Tasks 3-5 are the largest and riskiest part of this plan; Tasks 6-9 are independent of 3-5.

### Deliberate deviations from the spec

1. **Spec §6 omits `level` and `grade` from Reset.** `roster-browser.tsx:246-251` holds **six** filters - `location`, `program`, `level`, `grade`, `payment`, `engagement`. Resetting four of six would leave the button visibly failing to reset while `isDefault` reads true. Task 8 resets all six. **The spec has been corrected to match.**
2. **`/welcome/visitors` coordinator access is out of scope.** P1 v2 deliberately does not grant it (the route did not exist when P1 was written). `/welcome/visitors` falls to `packages/shared-domain/src/auth/can-access-route.ts:112` and welcome-team gets it for free; a coordinator does not. If coordinator access is wanted it is one path added to P1 v2 Task 4 Step 6's clause. **Task 6 must not assume P1 landed.**
3. **`/welcome/visitors` does NOT reuse `getLevelVisitorsView` across levels**, which spec §5.2 asks for. Calling it per level multiplies a genuine per-family fan-out by the level count - `readDoorGuestCheckIns` lists every `guest-families` doc and point-reads `checkIns/{date}` for each (`check-in-attendance.ts:113-153`), plus a `contactKeys` get per matched child (`visitors.ts:72`). Task 6 reads the levels once and groups in memory instead.

4. **`sessionDateFor` lives in `features/setu/calendar/`, which makes `features/check-in` import from `features/setu`.** CLAUDE.md discipline 1 forbids cross-feature imports, and `@cmt/shared-domain` is the discipline-clean home for a pure date function (`torontoYmd` already lives at `packages/shared-domain/src/setu/schemas/offering.ts:102`). Two reasons this ships as-is: the `boundaries/element-types` rule is currently **inert** (its `apps/portal/src/features/*` pattern is cwd-relative and never matches when lint runs as `eslint src` from `apps/portal` - the app config comments on this glob trap at `apps/portal/eslint.config.js:15-16`), and the reverse edge already exists at `features/setu/auth/build-session-claims.ts:1`. **But this adds the edge that makes setu ↔ check-in circular.** If you would rather not, put `sessionDateFor` in `@cmt/shared-domain` beside `torontoYmd` - it is a pure function with no server imports and the move is free.

5. **`guest_check_ins.date` keeps its calendar-day meaning.** v1 justified the dual-write as protecting "the admin reports that read it". That is false - `date` has exactly **one** reader in the repo, `check-in-attendance.ts:172`, which this plan moves off it. The dual-write is still right, for the real reasons: it is non-destructive to existing docs and `date` preserves the actual day the guest walked in, which `sessionDate` erases. Task 2 says so in the comment so nobody later assumes `date` is load-bearing.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/portal/src/features/setu/teacher/roster-confirmation.ts:77` | fid resolution for top-level donation docs | 1 |
| `apps/portal/src/features/setu/calendar/calendar.ts` | new `sessionDateFor(ymd)` - the single date-normalization seam | 2 |
| `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts:32-44` | dual-write `date` + `sessionDate` | 2 |
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
| `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx:8-15,89` | grade filter (mind the existing local `VisitorRow` and `grade` state) | 7 |
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
  //
  // The `eid` is load-bearing. Confirmation runs through isEnrollmentConfirmed,
  // whose donation clause is
  //   donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid)
  // (app/family/_helpers/enrollment-confirmation.ts:37). A donation without a
  // matching eid is grouped by fid and then discarded, so the test would still
  // fail after the fix and tell you nothing.
  const enr = base({ fid: 'CMT-FAM-01', eid: 'CMT-FAM-01-o' });
  const db = fakeDbWithTopLevelDonation({
    fid: 'CMT-FAM-01',
    donation: { status: 'completed', amountCAD: 200, fid: 'CMT-FAM-01', eid: 'CMT-FAM-01-o' },
  });
  const confirmed = await deriveConfirmedFidsForLevel(db, 'bala-vihar-2026-27', [enr]);
  expect(confirmed.has('CMT-FAM-01')).toBe(true);
});
```

Note the signature: **three** arguments, `(db, pid, enrollments)`. Use the file's existing `base()` helper (`__tests__/roster-confirmation.test.ts:39-41`) for the enrollment, and extend the existing `fakeDb` with a variant whose donation docs expose `ref.parent.parent === null` and carry `fid` in `data()`. Do not invent `seedEnrollment`/`seedDonation` helpers - this file has none.

The donations scan is guarded by `needsRead.length > 0` (`roster-confirmation.ts:72`) and **nothing else**. `paymentSource` gates only `getLegacyPaymentStatus` at `:88-91`, not the donations read. So the fixture must be `enrolledVia: 'promotion'` with no attended mid, which lands it in `needsRead` - `base()` already defaults to `'promotion'`. **Do not** set `paymentSource: 'legacy'` to "make the scan run"; that routes the fixture down the legacy branch and the test then passes or fails for reasons unrelated to the fid bug it exists to pin.

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

**The bug is real and verified.** The writer stamps `date: torontoYMD()` - the actual calendar day (`guest-check-ins.ts:40`). The teacher visitors page defaults its `?date=` to `mostRecentSunday()` (`app/teacher/levels/[levelId]/visitors/page.tsx:26`). A guest who checks in on a Sunday matches; a guest who checks in midweek is invisible on the Sunday view. The precedent for the fix is already in the repo: `features/setu/check-in/mark-door-attendance.ts:63-64` normalizes to `mostRecentSunday(now)` with a comment saying exactly why.

**One helper, three call sites.** The writer, the reader's caller, and the backfill must all compute the same Sunday. v1 spread that logic across three places and got it wrong in one of them, a full week off. A single exported function removes the possibility.

**Files:**
- Modify: `apps/portal/src/features/setu/calendar/calendar.ts` (add `sessionDateFor`)
- Modify: `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts:32-44`
- Modify: `apps/portal/src/features/setu/attendance/check-in-attendance.ts:168-173`
- Modify: `apps/portal/src/features/setu/teacher/visitors.ts:59-63` - **the sole caller, and v1 never touched it**
- Create: `apps/portal/scripts/backfill-guest-session-date.ts`
- Test: `apps/portal/src/features/setu/calendar/__tests__/calendar.test.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/visitors.test.ts`
- Test: `apps/portal/src/features/setu/attendance/__tests__/check-in-attendance.test.ts` - **asserts the old `date` query at `:12,18`; Step 5 breaks it**
- Test: `apps/portal/src/features/check-in/shared/__tests__/guest-check-ins.test.ts` - **would stay green with `sessionDate` missing; Step 4 has no coverage without it**

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
Compute the day **once** - two `torontoYMD()` calls are two independent clock reads and can disagree across a Toronto midnight:

```ts
    const ymd = torontoYMD();
    // ...
    // `date` is the actual Toronto calendar day the guest walked in. Kept for
    // forensic value and because rewriting existing docs would destroy it. Note
    // it has no PRIMARY reader after this change - check-in-attendance.ts:172
    // now queries sessionDate and only reads `date` as a transitional fallback.
    // Do not assume it is load-bearing.
    date: ymd,
    // `sessionDate` is the Sunday teachers actually view. A midweek guest was
    // previously invisible on the Sunday visitors panel.
    sessionDate: sessionDateFor(ymd),
    checkedInAt: new Date().toISOString(),
```
```

- [ ] **Step 5: Read `sessionDate`, and normalize at the caller**

`check-in-attendance.ts:172` - swap the field and rename the parameter to `sessionDate` so the contract is visible at the call site:

**Read BOTH keys for one release.** Existing `guest_check_ins` docs have no `sessionDate`, so a straight swap makes every pre-existing guest invisible between the deploy and the moment someone remembers to run the prod backfill. That is a regression from today's behaviour, on a Sunday, introduced by the fix. Both are single-field equalities, so this stays index-free:

```ts
export async function readPortalGuestChildren(sessionDate: string): Promise<DoorGuestChild[]> {
  // ...
  // Transitional: read both keys and de-duplicate by doc id. Pre-backfill docs
  // have only `date`; post-backfill and new docs have `sessionDate`. Drop the
  // `date` leg once the prod backfill has run - tracked in runbook 14.
  const [bySession, byDate] = await Promise.all([
    db.collection('guest_check_ins').where('sessionDate', '==', sessionDate).get(),
    db.collection('guest_check_ins').where('date', '==', sessionDate).get(),
  ]);
  const seen = new Set<string>();
  const docs = [...bySession.docs, ...byDate.docs].filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
```

Single-field equality on a top-level collection is auto-indexed. No composite index, no `firestore.indexes.json` change.

Also update the JSDoc at `:157-167`, which currently documents the `date` field, and the writer comment at `guest-check-ins.ts:24-26`, which says `date` is "the same key the teacher attendance/visitors screens query by" - false after this change.

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

- [ ] **Step 6: Write the caller test - assert the ARGUMENT, not a seeded round-trip**

`__tests__/visitors.test.ts:20` mocks the whole reader module:

```ts
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({
  readDoorGuestCheckIns: mockReadGuests, readPortalGuestChildren: mockReadPortalGuests,
}));
```

so there is no `guest_check_ins` collection to seed here - `readPortalGuestChildren` never touches Firestore in this suite. The contract Step 5 introduces is exactly what to assert:

```ts
it('normalizes the portal guest query to the session Sunday, leaving the legacy door key raw', async () => {
  await getLevelVisitorsView('L', '2026-09-09');
  expect(mockReadPortalGuests).toHaveBeenCalledWith('2026-09-06'); // normalized
  expect(mockReadGuests).toHaveBeenCalledWith('2026-09-09');       // raw - legacy door has its own key
});
```

Note also that `VisitorsView` has **no `visitors` field** - it is `doorVisitors` (`visitors.ts:34-42`), as the existing tests use at `__tests__/visitors.test.ts:58,80`. A real seeded round-trip belongs in `features/setu/attendance/__tests__/check-in-attendance.test.ts`, not here.

- [ ] **Step 6b: Update the two test suites this change breaks**

Both are currently written against the old `date` field and are **not** optional:

- `features/setu/attendance/__tests__/check-in-attendance.test.ts:12,18` documents and drives off `where('date','==',date)`. Step 5's swap breaks it.
- `features/check-in/shared/__tests__/guest-check-ins.test.ts:39-40` asserts the written doc shape (`written.date`, `written.checkedInAt`) and would stay **green with `sessionDate` missing entirely** - Step 4 is the write half of the fix and has zero coverage today. Add, with a frozen clock:
  ```ts
  expect(written.sessionDate).toBe(sessionDateFor(written.date));
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

**Get the fid set right first - this is the whole task.** `deriveRoster`'s `fids` and `enrMetaByFid` are keyed on **every family with an active enrollment for this program period at this location** (`roster.ts:135-139` filters `pid` + `status`; `:147` filters `location`). Level matching happens later, per member, in `buildRoster`. Passing that set to the contacts read would issue **hundreds** of parallel subcollection queries on the eager teacher render - the exact fan-out `roster.ts:156-174` was written to eliminate and `roster-fetch.test.ts:126-130` guards.

The level-scoped set comes from the **built** roster:

```ts
const roster = await deriveRoster(levelId, date, undefined, { withConfirmation: true });
// LEVEL-scoped: buildRoster has already applied memberMatchesLevel. deriveRoster's
// own `fids` is PROGRAM-and-location scoped (hundreds) - never use it here.
const levelFids = [...new Set(roster.members.map((m) => m.fid))];
const detail = await buildAttendanceDetailIndex(db, levelFids, roster.enrMetaByFid);
```

- **Enrollments: zero new reads.** `deriveRoster` already reads them and builds `enrMetaByFid` (`roster.ts:144`). Widen that map to carry the amount fields it currently discards at `:146`. It stays keyed by the program set; that is fine, it is a lookup map, not a read list.
- **Donations: chunked `in` queries on `levelFids`.** `donations` is top-level with an `fid` field, so `db.collection('donations').where('fid','in',chunk)` works directly. Chunk at 30 - Firestore's `in` cap is a **hard limit**, so an unchunked call throws `INVALID_ARGUMENT` rather than degrading. The chunker is load-bearing, not an optimisation. Filter `status === 'completed'` **in memory**; a second `where` would need a composite index this plan otherwise does not need.
- **Offerings: one batched `getAll`.** Typically exactly one `oid` per level.
- **Contacts: bounded parallel subcollection reads over `levelFids`.** `student-detail.ts:62` reads **exactly one** family this way, so it is a precedent for the shape, not for a bounded-N loop. Add a real cap so a future caller cannot silently pass the program set:

```ts
const MAX_DETAIL_FIDS = 80;
if (fids.length > MAX_DETAIL_FIDS) {
  throw new Error(
    `buildAttendanceDetailIndex got ${fids.length} fids. Expected a LEVEL-scoped set ` +
    `(~20-40). deriveRoster's own fids is program-and-location scoped - derive from ` +
    `roster.members instead.`,
  );
}
```

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
    /** LEVEL-scoped fids, from roster.members. NOT deriveRoster's own `fids`. */
    fids: string[],
    enrMeta: Map<string, {
      oid: string;
      enrolledAt: Date;                        // a Date, not a string - see below
      suggestedAmountOverride: number | null;
      suggestedAmountSnapshot: number | null;
    }>,
  ): Promise<Map<string, AttendanceDetail>>
  ```

  **`resolveSuggestedAmount(offering, enrollDate: Date): number`** (`packages/shared-domain/src/setu/schemas/offering.ts:95-98`) takes a **`Date`** and returns a **non-nullable `number`**. Two consequences:
  - `enrolledAt` is `z.date()` on the schema (`enrollment.ts:21`) and arrives from a raw `d.data()` read as a Firestore **`Timestamp`**. Convert it in `roster.ts` with the repo's `toDate()` helper (`build-csv-rows.ts:10-15`), the way `report-dataset.ts:96` does. A naive `new Date(timestamp as string)` yields `Invalid Date`, and `torontoYmd()` inside `resolveSuggestedAmount` (`offering.ts:102`) then picks `tiers[0]` - the wrong tier, silently.
  - `?? snapshot` after it is **dead code**. The fallback the three cited surfaces actually use is for a *missing offering*:
    ```ts
    const expected = override ?? (offering ? resolveSuggestedAmount(offering, enrolledAt) : snapshot);
    ```
    Exactly as `get-enrollments.ts:87`, `report-dataset.ts:180` and `build-csv-rows.ts:115` write it.

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
  // Guards the Firestore `in` cap, which is hard: an unchunked call throws
  // INVALID_ARGUMENT. Seed 65 fids, assert 3 queries.
});

it('returns a null parent when a family has no manager adult', async () => { /* ... */ });

it('throws if handed a program-scoped fid set', async () => {
  await expect(buildAttendanceDetailIndex(db, manyFids(81), enrMeta)).rejects.toThrow(/LEVEL-scoped/);
});

it('only reads detail for the level"s families, not the whole program period', async () => {
  // The regression test for the critical defect in the first draft of this plan.
  // Fixture: three levels sharing ONE pid at one location (the real shape -
  // roster-fetch.test.ts:86-93 has exactly this), families spread across them.
  // Assert the contacts read touched only the target level's fids.
  const roster = await deriveRoster('brampton-level-2', date, undefined, { withConfirmation: true });
  const levelFids = [...new Set(roster.members.map((m) => m.fid))];
  expect(levelFids.length).toBeLessThan(allProgramFids.length);
  await buildAttendanceDetailIndex(db, levelFids, roster.enrMetaByFid!);
  expect(fakeFs.perFamilyMemberSubGets).toBe(levelFids.length);
});
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

Convert `enrolledAt` with the repo's `toDate()` helper, then carry the three fields into the `enrMetaByFid.set(...)` at `:152`. **Zero extra reads** - these fields are already in the documents being read.

**Expose it by spreading in `deriveRoster`, and do not touch `buildRoster`'s signature.** `RosterResult` is returned by **two** functions: the pure `buildRoster(level, families, events, date, now, confirmedFids)` (`roster.ts:62-120`) and `deriveRoster`. `buildRoster` has no `enrMetaByFid` - its `RosterFamily` input (`:16-22`) carries only `fid / legacyFid / enrolledMids / members`. Adding a **required** field to `RosterResult` breaks `buildRoster`'s return at `:107-119` and all 12 `buildRoster(...)` call sites in `__tests__/roster.test.ts`. So:

```ts
// deriveRoster's return, roster.ts
return { ...buildRoster(level, families, events, date, now, confirmedFids), enrMetaByFid };
```

and declare it on `RosterResult` as optional (`enrMetaByFid?: Map<...>`), or as a separate return type for `deriveRoster` only. The `vi.mock('../roster')` mocks in `level-attendance-view.test.ts:4`, `save-attendance.test.ts:17`, `confirm-previous.test.ts:4` and `student-detail.test.ts:18` are untyped `vi.fn()`s, so they are unaffected either way.

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

  // Contacts: bounded parallel subcollection reads. `fids` MUST be the
  // level-scoped set derived from roster.members - the cap above enforces it.
  // deriveRoster's own `fids` is program-and-location scoped (hundreds) and
  // passing it here reintroduces the fan-out roster.ts:156-174 removed.
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
- Test: `apps/portal/src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx` - **widening `AttendanceViewRow` with required fields breaks the `ROWS` fixture at `:16-19` and the inline row literals at `:237` and `:253`.** Either add the new fields to all three, or declare them optional on `AttendanceViewRow` and say which you chose.

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

Join `buildAttendanceDetailIndex`'s output by `fid` in `getLevelAttendanceView`, and map `safetyNotes` from `m.foodAllergies ?? null`. The `?? null` is required, not defensive: `level-attendance-view.test.ts:15-18`'s `mockDerive` members have no `foodAllergies`, and a bare read yields `undefined`, which `exactOptionalPropertyTypes` rejects against `string | null`.

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

**The row restructure is the risky part.** Rows are `<button>` elements today (`attendance-marker.tsx:509`, spanning `:509-578`), which makes a nested `View profile` link invalid HTML. Spec §4.5: the row becomes a plain container, the toggle is a button, `View profile` is a link.

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

(`__tests__/attendance-marker.test.tsx:27-29`). Replacing the row `<button>` with a container breaks every use. **Enumerate the full blast radius before you start** - it is larger than the helper:

- `row(...)` at `:43, :44, :52, :58, :59, :65, :79, :92, :101, :109, :160, :195, :196, :199, :241, :248, :249, :255` - ~18 usages
- four direct row lookups the helper rewrite does not cover: `getByRole('button', { name: /.../i })` at `:68, :69, :70, :235`
- **five `queryAllByTestId('att-row')` length assertions** at `:91` (1), `:118` (0), `:174` (2), `:176` (1), `:186` (1). `data-testid="att-row"` **already exists** on the row button (`:512`) - it is not something this task adds. If the desktop table and the mobile card list both emit it, every one of these counts **doubles**. Either scope the id per branch (`att-row-desktop` / `att-row-mobile`) or halve the expected counts, and say which.

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
  // Widen rather than narrow: the drawer trigger, a select, or any future
  // interactive child must not fall through to a toggle.
  if ((e.target as HTMLElement).closest('a, button, select, input, [role="button"]')) return;
  toggle(r.mid);
}}
```

- [ ] **Step 4: Build the rest of §4.1-4.3**

Stat cards, info banner, search + filter chips with counts, `Mark all present`, the desktop table columns, the mobile card list, the detail drawer (Attendance / Registration / Primary Parent / Actions / Note), and the footer bar. Keep the existing safety dot and give it an accessible label (§4.3) - it is a bare visual today. The drawer gets a `Safety & medical` block rendering `safetyNotes` as text.

**Four things in §4.1 collide with the component as built. Decide each before writing code, and record the decision:**

1. **Four-state stat cards and chips vs a binary model.** §4.1 wants ENROLLED · PRESENT · UNMARKED · ABSENT and chips All/Present/Unmarked/Absent. `AttendanceMarker` is explicitly binary: one `present` map (`:130-137`), a filter of `'all' | 'unmarked'` (`:140`), and `buildMarks()` (`:205-209`) writes `absent` for everything untapped. Distinct Unmarked-vs-Absent counts need a **three-state** local model seeded from `AttendanceViewRow.status`, which also changes the tap gesture, `markAllToggle`, and the autosave payload. That is materially bigger than "stat cards with counts". Either specify that migration, or record the deviation that Absent stays fused with Unmarked and drop it from the cards and chips.
2. **`data-unmarked` duplication breaks "Next unmarked" on mobile.** `jumpNext()` does `document.querySelectorAll('[data-unmarked="1"]')` (`:253`). With a table and a card list both emitting it, the query returns both branches; on a phone the desktop nodes are `display:none`, so `getBoundingClientRect().top` is 0 and `scrollIntoView` is a no-op. The floating button (`:597-625`) silently stops working. Scope the selector to the visible branch.
3. **The drawer's "Enrollment Status chip" is a constant.** Every row in `rows[]` is confirmed by construction - `roster.ts:80` routes unconfirmed families to `previousStudents`. Say so and drop it, or add a real field.
4. **"View registration ↗" has no target.** `/teacher/students/[mid]` exists and covers "View full profile"; the second link points nowhere. Name a route or drop it.

§4.1's header also specifies counted `Visitors (n)` / `Previous students (n)` buttons and a `📅 date ▾` dropdown. Today there is one uncounted `Visitors →` link (`:341-360`), the date nav is prev/next arrows (`:319-336`), and the previous-students link was **deliberately removed** - pinned by an existing assertion at `__tests__/attendance-marker.test.tsx:215`. Re-adding it contradicts that test. Scope them in or record the deviation.

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

Read the enabled levels once with the existing `fetchEnabledLevelsForPid(oid)` (`features/setu/enrollment/derive-child-level.ts:36`, already used at `mark-door-attendance.ts:59`) - do not write a new levels read - then group the date's guest children by level with the existing `guestMatchesLevel` predicate (`visitors.ts:15-23`).

**Access.** `/welcome/visitors` falls to `packages/shared-domain/src/auth/can-access-route.ts:112` and welcome-team gets it with **no new clause**. Do not add one. **Do not assume P1 landed** - P1 v2 deliberately does not grant this path to a coordinator, so scope the access test to welcome-team and admin only. If coordinator access is wanted later it is one path added to P1 v2 Task 4 Step 6.

**Nav - two sidebars, not one.** P1 v2 does **not** add a Visitors nav link (visitors was removed from P1's scope). This task owns it, or the page is unreachable - which is requirement 1 in spec §0.

`WELCOME_NAV_ITEMS` (`desktop-sidebar.tsx:65-73`) is **not what an admin sees**. `welcome/layout.tsx` renders `AdminSidebarLive` for admins and `DesktopSidebarLive` only for non-admin welcome-team, with a comment saying admins are deliberately kept in the admin sidebar. So wiring only `WELCOME_NAV_ITEMS` leaves `/welcome/visitors` unreachable for every admin - the exact failure this paragraph exists to prevent.

Add the entry to **both**:
- `features/family/components/desktop-sidebar.tsx` - `WELCOME_NAV_ITEMS`, plus a new member on the `SidebarTab` closed union (`:9`) and the `deriveActiveFromPathname` mapper
- `features/admin/components/admin-sidebar.tsx` - the `NAV_GROUPS` entry and its `deriveActive` mapping at `:44-51`
- `features/family/components/welcome-mobile-nav.tsx`

If P1 v2's Task 6 is also in flight, both plans touch `desktop-sidebar.tsx` and `admin-sidebar.tsx`. Sequence them or expect a conflict.

- [ ] **Step 1: Write the failing page test**
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement the page** (levels once, group in memory, per the read pattern above)
- [ ] **Step 4: Add the nav entries** to `WELCOME_NAV_ITEMS` and `welcome-mobile-nav.tsx`
- [ ] **Step 5: Run the tests**
- [ ] **Step 6: Commit**

---

## Task 7: Visitor grade filter

Spec §5.4. Client-side only - `VisitorRow` already carries `grade` (`visitors.ts:25-32`) and `getLevelVisitorsView` already grade-matches to the level. No new read, no index.

**Three collisions to avoid** in `visitors-panel.tsx`:
- It already declares `const [grade, setGrade] = useState('')` at `:89` for the **add-visitor** form (used at `:149`, `:277`). Name the filter state something else - `gradeFilter`.
- The add-visitor `<select>` already carries `aria-label="Grade"` at `:279`. A second control named "Grade" makes `getByRole('combobox', { name: /grade/i })` ambiguous and `getBy*` throws. Give the filter a distinct accessible name - "Filter by grade".
- It declares its **own local** `interface VisitorRow` at `:8-15`; it does not import the shared type from `visitors.ts:25-32`. They are field-identical today. Either import the shared one deliberately or leave the local one alone - do not assume they will stay in sync.

**Say which list the filter applies to.** The panel takes no visitor data as props - `teacher/levels/[levelId]/visitors/page.tsx` passes only `levelId / levelName / date`, and the panel fetches `/api/setu/teacher/visitors` client-side in `load()` (`:96`), holding the result in `view`. `view` has **two** lists: `doorVisitors` (type `VisitorRow`) and `confirmed` (a different type, `DetailedGuest`). Filtering only `doorVisitors` while `confirmed` stays unfiltered will read as a bug. Decide and state it.

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

`RosterBrowser` **is** the independent-state case - it renders `<RosterContent>` twice (`:446-474`), so act on every match. Follow `clearDefaultFilters()` at `roster-browser.test.tsx:56-60`.

**Reset must render OUTSIDE the `!searchActive` gate.** `roster-browser.tsx:346` wraps the entire filter grid *and* the summary in `{!searchActive && (...)}`, where `searchActive = query.trim().length > 0` (`:262`). The moment search text exists, **every combobox unmounts** - `getAllByRole('combobox', ...)` returns `[]` and any `for...of` over it is a silent no-op. Put Reset next to the count/export row at `:389-399`, which is always mounted, or it cannot clear the search it is specified to clear. `isDefault` must include `query === ''`.

Assert the filters and the search separately, because they cannot both be set at once:

```ts
it('reset restores all six filters', async () => {
  render(<RosterBrowser {...props} />);        // no search text: the grid is mounted
  // Level and Grade are conditionally rendered (:357, :363) - a loop over an
  // empty array passes vacuously, so assert length first. The fixture needs
  // bvChildren carrying a levelName and a grade.
  expect(screen.getAllByRole('combobox', { name: 'Level' }).length).toBeGreaterThan(0);
  for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) await userEvent.selectOptions(sel, '');
  // ... location / program / level / grade / Enrollment (the accessible name at :374)
  for (const btn of screen.getAllByRole('button', { name: /reset/i })) await userEvent.click(btn);
  for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) expect(sel).toHaveValue('paid');
  for (const sel of screen.getAllByRole('combobox', { name: 'Level' })) expect(sel).toHaveValue('');
});

it('reset clears the search box, and stays mounted while searching', async () => {
  render(<RosterBrowser {...props} />);
  for (const box of screen.getAllByRole('searchbox')) await userEvent.type(box, 'rana');
  // The filter grid is unmounted here by design; Reset must not be.
  expect(screen.getAllByRole('button', { name: /reset/i }).length).toBeGreaterThan(0);
  for (const btn of screen.getAllByRole('button', { name: /reset/i })) await userEvent.click(btn);
  for (const box of screen.getAllByRole('searchbox')) expect(box).toHaveValue('');
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

> **✅ SHIPPED 2026-07-26. 7/7 green against deployed UAT.** What the plan above got
> wrong, and what the specs do instead:
>
> **The spec cannot choose the guest's date.** `recordGuestCheckIn` reads the SERVER
> clock (`guest-check-ins.ts:27`); nothing in the request influences `date` or
> `sessionDate`. This matters because the suite was authored on a **Sunday**, when
> `sessionDateFor(today) === today` - so "submit the form, look at today" passes
> with Task 2's fix fully reverted. The plan's one-line Step 1 would have shipped
> exactly that. The fix is pinned from both ends instead, neither depending on the
> run day: the **writer** is asserted by reading the doc the form produced back and
> requiring `sessionDate === sessionDateFor(date)`, and the **reader** by a second
> guest stamped `sunday + 3` which the spec first proves is invisible to the pre-fix
> `where('date','==',sunday)` query before asserting the teacher screen shows it.
>
> **Both layouts dual-render.** `welcome/layout.tsx:141-166` and the teacher layout
> each render `{children}` twice (mobile branch + desktop branch), so every element
> exists twice in the DOM. Every locator filters `visible: true`; the first run died
> on strict-mode violations, not on the feature.
>
> **Three guests, not two.** Two grades in two levels is the N=2 grouping case the
> plan asked for; the third (grade `Shishu`) is the unmatched bucket, which is the
> only place a dropped child would ever be noticed. Because the door records no
> centre, the two matched children produce **four** group rows - so the headline
> count moving by exactly **3** is what holds `childCount = children.length` in
> place against the sum-of-groups reading.

**Files:**
- Create: `apps/portal/e2e/setu/teacher/guest-to-teacher.spec.ts`
- Create: `apps/portal/e2e/setu/admin/welcome-visitors.spec.ts`

- [x] **Step 1: Write the UI→UI guest→teacher spec**

Against **deployed** UAT. Submit the real guest form (`guest-check-in-form.tsx`) with a child name and grade and the required parent email and phone, then sign in as the teacher persona, open the level matching that grade, and assert the child appears in the visitors panel. This is the flow Task 2's date-key fix exists to make work, so it is also Task 2's real acceptance test.

Shipped as two sessions: the door half runs on the shared E2E family (family-manager **+ admin**, which is what `can-access-route.ts:40` needs), the teacher half on `setu-test-teacher-brampton@`, whose only level is `brampton-level-1-bv-brampton-2025-26` (band `['1']`) - a narrow persona, so the test proves a real teacher sees the guest rather than that an admin sees everything.

- [x] **Step 2: Write the `/welcome/visitors` spec**

Two guest families across two levels, so the grouping is exercised with N=2 rather than a single-row fixture.

Grades chosen against live UAT level data: `1` → Brampton Level 1 + Scarborough Level A, `6` → Brampton Level 4 + Scarborough Level C, `Shishu` → no class. Counts are asserted as **deltas** against a baseline read before seeding, never absolutes - the page is shared with whoever else checked in that day.

- [x] **Step 3: Run against deployed UAT**

```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu guest-to-teacher welcome-visitors
```

Password sign-in, never OTP. Never run the whole setu suite - the OTP limiter cascades.

- [x] **Step 4: Clean up what the specs created**

Guest check-ins written by the spec must be removed, or they accumulate in UAT and pollute every later visitors run.

Each spec collects the doc ids it wrote and deletes them in `afterAll` (loudly, via `console.warn` with the ids, if the delete itself fails). Verified empty after both a failing and a passing run. Nothing else is mutated: the specs never click **Confirm**, which would create a pending family + auto-enrollment.

- [x] **Step 5: Commit**

---

## Self-review

**Spec coverage.** §4.1-4.2 layouts → Task 5. §4.3 allergies → Tasks 4 (data) + 5 (row label, drawer block). §4.4 data + bulk-read mandate → Task 3. §4.5 row restructure → Task 5 Step 3. §4.6 privacy → recorded, and **extended** in Task 4 Step 5 because allergy free-text was not part of the original decision. §5.1 date defect → Task 2. §5.2 `/welcome/visitors` → Task 6. §5.3 E2E → **Task 9** (v1 marked this covered when it was not). §5.4 grade filter → Task 7. §6 Reset → Task 8, with the spec's own omission of `level`/`grade` corrected.

**Type consistency.** `sessionDateFor(ymd)` is defined in Task 2 and used in the writer, `visitors.ts`, and the backfill. `buildAttendanceDetailIndex(db, fids, enrMeta)` is defined in Task 3 and consumed in Task 4. `AttendanceDetail`'s four fields map onto `AttendanceViewRow`'s new fields plus `safetyNotes`, which comes from `RosterMember.foodAllergies` added in Task 4 Step 3.

**Every review finding is addressed:** C1 → Task 2 Steps 1-3 (one helper, noon-UTC anchor, a test that pins the week-off case) plus `--recompute`. C2 → Task 2 Step 5 (the caller). M1 → Task 3's read budget. M2 → Task 3 Step 1's live-amount test. M3 → Task 4 Step 3. M4 → Task 4 Step 5. M5 → Task 5 Step 2 (fetch body, no `onMark`). M6 → Task 5 Step 1's `row`/`toggle` helpers. M7 → Global Constraints + Tasks 5 and 8. M8 → Task 5 Step 1 (migrate first). M9 → Task 9. m1 → Deviation 3. m2 → Task 1 Step 1. m3 → Task 3 Step 6 (no index, no branch). m4 → Task 8 + the spec. m5 → Task 7. m6 → Task 6's single reading.

## Review history

Reviewed once after the first draft (`docs/superpowers/reviews/2026-07-25-review-p2v2.md`): 1 critical, 16 major, 14 minor. Everything re-verified against the code is folded in above. The four that changed the most:

1. **The critical was mine, and it undid the plan's own central rule.** Task 3 called the fid set "level-scoped, 20-40 families" and told the implementer to take it from `enrMetaByFid`. But `deriveRoster`'s enrollment scan filters on `pid` + `location` and defers level matching to `buildRoster`, so that set is **program-and-location scoped - hundreds**. The contacts read would have issued ~500-800 parallel subcollection queries on the eager teacher render, which is exactly the fan-out `roster.ts:156-174` was written to remove. Now derived from `roster.members`, with a hard cap that throws.
2. **`resolveSuggestedAmount(offering, enrollDate: Date): number`** takes a `Date` and returns a non-nullable number. The plan typed `enrolledAt: string` (it arrives as a Firestore `Timestamp`) and wrote a `?? snapshot` fallback that is dead code. As specified it would not typecheck, and the naive repair silently picks the wrong pricing tier - defeating the chip-parity fix it exists to deliver.
3. **Both bug-fix tests were unrunnable.** Task 1's fixture donation had no `eid`, and confirmation matches on `eid`, so the flagship test still fails *after* the fix. Task 2's caller test referenced `view.visitors` (the field is `doorVisitors`) and tried to seed a collection that suite mocks away.
4. **"Act on every match" is wrong for `AttendanceMarker`.** It holds one `present` map, so acting on both branches double-toggles and nets zero - contradicting the plan's own `toggle()` helper. The constraint now distinguishes separate component instances (`RosterBrowser`) from shared state.

Also corrected: four test suites the plan broke without listing (`check-in-attendance.test.ts`, `guest-check-ins.test.ts`, `attendance-marker.test.tsx`'s `ROWS` fixture, and 12 `buildRoster` call sites); a deploy window where every existing guest check-in went invisible between the reader swap and the prod backfill; `/welcome/visitors` unreachable for admins because they get `AdminSidebarLive`, not the welcome sidebar; and Reset unmountable because `roster-browser.tsx:346` hides the whole filter grid while searching.

**Verified correct and left alone:** `sessionDateFor`'s arithmetic across Sunday/Monday/Saturday and both 2026 DST switches; the no-new-index claim against the full `firestore.indexes.json`; `guest_check_ins.date` having exactly one reader; and P1 v2 genuinely not granting `/welcome/visitors` or its nav link.

**Known risk.** Task 5 is the largest single piece in the whole launch batch - a full UI rebuild of the screen every teacher uses every Sunday, on top of a test suite that must be migrated rather than extended. It is also the most cuttable: Tasks 1, 2, 3, 4 deliver real fixes and real data without it, and the current attendance screen works. If the week compresses, ship 1-4 and 6-9 and let the visual rebuild slip.
