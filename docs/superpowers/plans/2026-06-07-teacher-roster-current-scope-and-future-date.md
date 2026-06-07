# Teacher Roster: current-student scoping + future-date guard — Plan

> Subagent-driven. Controller re-runs the backfill (T3) + verifies.

**Two issues found in UAT after go-live:**
1. **Inflated rosters.** The check-in app shows Level 1 (Gr 1) ≈ 53 students; the portal shows 75 (Pre-Level 1: 122). Cause: (a) the backfill enrolled families' **inactive/graduated** kids (the legacy roster accumulates since 2012; 224 of 1059 kids have a NULL `level` = not currently registered), and (b) `deriveRoster` grade-matches **every member of an enrolled family, ignoring `enrolledMids`**. The roster must respect `enrolledMids`, and the backfill must enroll only **current** kids (non-NULL legacy `level`).
2. **Future-date "all present".** Navigating to a future Sunday (e.g. June 7, tomorrow) shows everyone pre-filled Present ("122/122 present") — looks like completed attendance for a class that hasn't happened. The marker must block future dates and signal "not taken yet".

**Confirmed data (live read-only dump):** `level` is the current-registration signal (835 current / 224 inactive). `classyear` is NULL for ~all. `level="Level 1 (Gr 1)"` = 54 kids all grade 1 (≈ check-in app's 53). `level="Pre L1 (Gr JK-SK)"` = 89 (grades 0/-1). Legacy level strings encode the grade, so grade-band matching ≈ the legacy level bucketing for current kids.

## Standing constraints
UAT writes only; read-only 715b8; idempotent; no new index; full `pnpm --filter @cmt/portal lint` before commits; never `--no-verify`; subagents on Opus.

---

## Task R1: `deriveRoster` respects `enrolledMids`

A family member appears on a level's roster only if they are in that level's offering's **active enrollment `enrolledMids`** AND grade-match the level. (Today it grade-matches every family member — wrong once a family has non-enrolled/graduated members.)

**Files:** `apps/portal/src/features/setu/teacher/roster.ts` + `apps/portal/src/features/setu/teacher/__tests__/roster.test.ts`

- [ ] **Step 1 (test first):** In `roster.test.ts`, add `enrolledMids` to the `RosterFamily` fixtures and assert that a family member NOT in `enrolledMids` is excluded even if their grade matches, and one IN `enrolledMids` + grade-match is included. Update existing fixtures to include `enrolledMids` (set to the mids they expect on the roster). Run → fail.

- [ ] **Step 2:** `RosterFamily` gains `enrolledMids: string[]`. In `buildRoster`, the member loop becomes:
```ts
for (const m of fam.members) {
  if (!fam.enrolledMids.includes(m.mid)) continue;     // ← only enrolled members
  if (!memberMatchesLevel(m, level, now)) continue;
  ...
}
```
In `deriveRoster`, when collecting enrolled families, capture each family's `enrolledMids` for this offering (the enrollment doc already has it) and pass it through. Build a `Map<fid, string[]>` from `enrollSnap` (the docs already read), then each `RosterFamily` carries its `enrolledMids`. (A family has one active enrollment per pid → one enrolledMids array; if somehow multiple, union them.)

- [ ] **Step 3:** Run the roster test → pass. Then `pnpm --filter @cmt/portal exec tsc --noEmit && pnpm --filter @cmt/portal lint`.

- [ ] **Step 4:** Check callers of `buildRoster`/`RosterFamily` compile (level-attendance-view consumes `deriveRoster`'s result, not RosterFamily directly — should be unaffected). Run the broader teacher suite: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher`.

- [ ] **Step 5: Commit** `fix(teacher): roster respects enrolledMids — exclude non-enrolled/graduated family members`.

---

## Task R2: backfill enrolls only CURRENT kids (non-NULL legacy `level`)

**Files:** `apps/portal/scripts/backfill-bv-enrollments.ts` (+ a small parser helper if needed)

The backfill must identify current kids by the legacy `level` field. The parser (`fetchLegacyFamilyForMigration`) currently returns children with `schoolGrade`/`legacySid` — it must ALSO expose each child's legacy `level` (or a `currentlyRegistered` boolean), so the backfill can filter.

- [ ] **Step 1:** In `apps/portal/src/features/setu/registration/legacy-parser.ts`, ensure the parsed child carries the raw legacy `level` (e.g. add `legacyLevel: string | null` to the child shape, cleaned; NULL/"NULL"/empty → null). (If the parser's child type isn't easily extended, the backfill can re-read the roster rows itself via `listAllFamilies()`/`findFamilyById` and map sid→level. Prefer extending the parser.) Add/adjust a parser test for the new field.

- [ ] **Step 2:** In the backfill `processFamily`:
  - `currentChildren` = parsed children whose `legacyLevel` is non-null.
  - `enrolledMids` = the Setu mids of those current children (map via legacySid).
  - If `currentChildren.length === 0`: the family has no current BV kids → if an enrollment doc already exists (from the prior run), set it `status: 'cancelled'` (merge); do NOT create one. Return `skipped-no-current-children`.
  - Else: upsert the enrollment with `enrolledMids = currentMids`, `status: 'active'` (overwrites the prior all-kids enrolledMids — `set(..., {merge:true})` replaces the array field). Keep `pid: oid`.
  - The schoolGrade re-assert stays for current kids (so JK/SK is correct).
- [ ] **Step 3:** Update the summary to report current-enrolled / deactivated / skipped. Typecheck (isolated tsc for the script) + lint.
- [ ] **Step 4: Commit** `fix(scripts): backfill enrolls only currently-registered kids (non-NULL legacy level); deactivate stale`.

---

## Task R3: future-date guard + "not taken yet" honesty (marker)

**Files:** `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx`, `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx`, `apps/portal/src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx`

- [ ] **Step 1:** The page passes `today={torontoToday()}` (import from `@/features/setu/calendar/calendar`) into `<AttendanceMarker>`. Add `today: string` to `AttendanceMarkerProps`.

- [ ] **Step 2:** In the marker, derive:
```ts
const isFuture = date > today;                                  // class hasn't happened
const canGoNext = addDays(date, 7) <= today;                   // next Sunday must be past/today
const hasSaved = rows.some((r) => r.source === 'portal');      // a teacher already recorded this date
```
  - **Next arrow ("›"):** when `!canGoNext`, render a disabled, non-link version (greyed: `opacity:0.4`, `pointerEvents:'none'`, `aria-disabled`). (Default date = mostRecentSunday, so by default next is already disabled — correct.)
  - **If `isFuture`:** replace the roster + the fixed Save bar with an "upcoming class" card: heading "This class is upcoming", body "Attendance for {prettyDate(date)} can be taken on class day." Keep the header + date nav (so they can go back via "‹"). Do NOT render the present/late/absent rows or the Save bar (nothing to save).
  - **If `!isFuture && rows.length > 0 && !hasSaved`:** show a subtle banner above the rows: "Attendance not taken yet — everyone defaults to Present. Tap a status to flag exceptions, then Save." (`--info-soft`/`--info-deep`, small.) When `hasSaved`, no banner (or a tiny "Saved" note — optional).
  - Footer "{presentCount} / {total} present" stays for non-future dates.

- [ ] **Step 3 (tests):** Update `attendance-marker.test.tsx` — pass a `today` prop (use a date AFTER the fixture `date` so existing "renders rows / saves" tests still see a non-future, and `canGoNext` true/false as needed). Add: (a) a future `date` (date > today) renders the "upcoming" card and NO `att-row` + NO Save button; (b) next-arrow disabled when `addDays(date,7) > today`; (c) "not taken yet" banner shows when all rows are `source:'default'`/`'door'` and hides when any row is `source:'portal'`. Keep the existing tests green (add `today` to their props).

- [ ] **Step 4:** Run `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx` → pass. tsc + lint.

- [ ] **Step 5: Commit** `fix(teacher): block future-date attendance + flag "not taken yet" (default-present honesty)`.

---

## Task R4 (controller): re-run backfill + verify
1. After R1+R2 ship: dry-run `--limit 30` to sanity-check current-vs-inactive split.
2. Full re-run `pnpm --filter @cmt/portal backfill:bv-enrollments` (overwrites enrolledMids to current-only; deactivates all-inactive families).
3. Verify via `deriveRoster` that counts now ≈ the check-in app: Level 1 ≈ 54, Pre-Level 1 ≈ 89 (down from 75/122). Spot-check a Scarborough level. Confirm a future date shows the upcoming card and a past untaken date shows the "not taken yet" banner.

## Self-review
- The over-count has TWO causes — both fixed: enrolledMids gating (R1) + current-only enrollment (R2). Either alone is insufficient (R1 needs correct enrolledMids; R2 needs the roster to honor them).
- `enrolledMids` now = current BV kids → also corrects the dashboard kids-count + T4 family union (which read enrolledMids).
- Future-date + not-taken-yet (R3) makes the default-present model honest without abandoning it (CMT Developer's chosen model).
- Idempotent re-run; UAT only; no new index.

## Known follow-ups
- Faithful legacy-`level`→portal-level mapping (vs grade-band) if grade/level inconsistencies surface (rare).
- School-year promotion/rollover to 2026-27 (separate, still pending).
