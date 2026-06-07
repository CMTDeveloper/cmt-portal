# Attendance: door-seeded, default-unmarked model — Plan

> Subagent-driven. Reverses the T2 "default present, flag exceptions" model per CMT Developer (2026-06-07): "by default every student be unchecked/not selected; as they check in at the door (family check-in) they show present in the teacher dashboard."

**Problem:** The marker defaults EVERY student to Present, so a class where only 11 of 53 checked in still reads "53/53 present" — misleading. The check-in app's truth: 11 checked in (selected), the rest unchecked.

**New model (door-seeded):**
- A student's initial status = **prior portal teacher mark** if any → else **Present if they checked in at the door** → else **unmarked** (no status selected).
- The teacher taps Present/Late/Absent to mark; tapping the **active** status again **unselects** it (back to unmarked).
- **Save writes only MARKED students** (present/late/absent); unmarked students get NO `attendanceEvent` (they remain "unaccounted" for the date). So an untouched class with 11 door check-ins saves 11 present, 42 unaccounted — honest.
- Counts everywhere reflect reality: Present = door-checked-in + teacher-marked-present (not the roster size).

## Standing constraints
UAT only; no new index; full `pnpm --filter @cmt/portal lint` before commits; never `--no-verify`; subagents on Opus; preserve test hooks (`data-testid="att-row"`, "Save attendance", "Visitors →", `· door` pill).

---

## Task D1: view-model seeds unmarked (door→present, portal wins)

**Files:** `apps/portal/src/features/setu/teacher/level-attendance-view.ts` + `__tests__/level-attendance-view.test.ts`

- [ ] **Step 1 (test first):** update `level-attendance-view.test.ts` so a row with NO portal mark and NO door check-in has `status: null, source: 'default'`; a door-checked-in row has `status: 'present', source: 'door'`; a portal-marked row keeps its mark + `source: 'portal'`. Assert `presentCount` counts only present rows (door + portal), NOT the total. Run → fail.

- [ ] **Step 2:** Change `AttendanceViewRow.status` type to `SetuAttendanceStatus | null` (null = unmarked). In `getLevelAttendanceView`, replace the seeding block with:
```ts
const checkedInAtDoor = !!m.legacySid && doorSids.has(m.legacySid);
let status: SetuAttendanceStatus | null;
let source: AttendanceRowSource;
if (m.status !== 'unaccounted') { status = m.status; source = 'portal'; }   // prior teacher mark wins
else if (checkedInAtDoor) { status = 'present'; source = 'door'; }           // door check-in → present
else { status = null; source = 'default'; }                                 // unmarked
```
`presentCount = rows.filter((r) => r.status === 'present').length` (already correct — now reflects door+portal only).

- [ ] **Step 3:** Run the view test → pass. tsc + lint. (Only consumer of `AttendanceViewRow` is the marker + the roster API route, both updated/compatible — the route just forwards the view.)

- [ ] **Step 4: Commit** `feat(teacher): seed attendance unmarked by default; door check-in → present (door-seeded model)`.

---

## Task D2: marker handles unmarked + honest counts/save

**Files:** `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` + `__tests__/attendance-marker.test.tsx`

- [ ] **Step 1 (tests):** update `attendance-marker.test.tsx`:
  - Rows seed from `row.status` INCLUDING null → an unmarked row has NO active status button (none `aria-pressed`).
  - Tapping a status sets it; tapping the SAME active status again **unselects** (back to none active).
  - The Save POST body `marks` contains ONLY marked mids (unmarked excluded).
  - Stat strip: Present = count of present marks (e.g. door-seeded rows), NOT total; add/verify an **Unmarked** count = total − (present+late+absent).
  - Footer reads "{present} present" + "{unmarked} not marked" (not "all present" when unmarked > 0).
  Run → fail.

- [ ] **Step 2:** Implement:
  - `marks` state type `Record<string, SetuAttendanceStatus | null>`, seeded `init[r.mid] = r.status` (null preserved).
  - `setStatus(mid, status)`: if `marks[mid] === status` → set `null` (toggle off); else set `status`.
  - Button `active = marks[r.mid] === o.value` (null → no button active). An unmarked row shows all three as outline (no fill). Use `marks[r.mid] ?? null` (do NOT default to 'present').
  - Live counts: `present`/`late`/`absent` from `Object.values(marks)`; `marked = present+late+absent`; `unmarked = total − marked`.
  - **Stat strip:** Enrolled · Checked-in(door) · Present · Late · Absent — Present now reflects reality. (Unmarked is derivable; optionally add a 6th "Unmarked" card or show it in the footer.)
  - **Footer:** primary "{present} present"; secondary "{unmarked} not marked" (muted) when unmarked > 0, else "all marked"/"{absent} absent" as fits. Progress bar = `marked / total` (marking completeness), not present/total.
  - **Banner (door-aware, updated copy):** portal marks exist → no banner; door check-ins → "{doorCount} checked in at the door — marked Present. Mark the rest, then Save."; neither → "No check-ins yet — tap a status as students arrive, then Save." (drop "everyone defaults to Present").
  - **Save:** POST body `marks` = only entries where status !== null:
    ```ts
    const marked: Record<string, SetuAttendanceStatus> = {};
    for (const [mid, s] of Object.entries(marks)) if (s) marked[mid] = s;
    // body: { levelId, date, marks: marked }
    ```
    Disable Save when `marked` is empty (nothing to record) — and keep the future-date guard (no Save bar on future dates).
  - Keep all test hooks + the `· door` pill + the empty/upcoming cards.

- [ ] **Step 3:** Run the marker test → pass. tsc + lint.

- [ ] **Step 4: Commit** `feat(teacher): unmarked default + honest present count + marked-only save (door-seeded model)`.

> `saveAttendance` (server) is UNCHANGED — it writes whatever marks it receives; the client now sends only marked students, so unmarked → no event (unaccounted). Confirm `SaveAttendanceSchema` accepts a possibly-smaller marks map (it does — `z.record`).

---

## Task D3 (controller): verify
1. tsc/lint/test green; push (gate).
2. Walk UAT: open Brampton Level 1 on **2026-05-31** → expect **Present = 11 (door), Unmarked = 42**, footer "11 present · 42 not marked", door rows show Present active + `· door`, the other 42 rows have NO active status. Tap a few Present/Absent; tap an active one to unselect; Save → reopen shows the saved marks (and unmarked stay unmarked). A future Sunday still shows the "upcoming" card.

## Self-review
- Reverses default-present → default-unmarked; door check-in is the auto-present signal (matches how families actually check in at the ashram). Save records only what's marked → counts are truthful.
- `AttendanceViewRow.status` is now nullable — only the marker consumes it; the page/route forward the view unchanged.
- Toggle-to-unselect gives the "unselect" the user asked for, distinct from explicit Absent.
- Known edge (documented): unmarking a PREVIOUSLY-saved student then saving does NOT delete the old event (save upserts marked only). Rare; teacher can mark Absent instead. A future "delete on unmark" can be added if needed.

## Known follow-ups
- Optional: a "Mark all present" quick action (if a teacher wants the old bulk behavior for a full-attendance day).
- School-year promotion/rollover to 2026-27 (still pending).
