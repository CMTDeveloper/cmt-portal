# Teacher roster: "Enrolled" vs "Previous students" — design

**Date:** 2026-07-12
**Status:** Draft (awaiting user review)
**Owner ask:** Vaibhav (via CMT Developer) — teacher rosters show hundreds of "enrolled"
students who are really last-year's roster carried forward. Split the roster so the
main attendance list shows only *truly enrolled* students; put the carried-forward
ones in a secondary "Previous students" list where a teacher can mark one present,
which confirms that family and moves them (and their siblings) into the main list
going forward.

---

## 1. Problem (code-backed)

The teacher attendance screen's **ENROLLED** number is a raw count of *active
enrollment records* for the level's period — there is no engagement check.
`deriveRoster` (`apps/portal/src/features/setu/teacher/roster.ts:116-120`) queries:

```
collectionGroup('enrollments').where('pid','==',level.pid).where('status','==','active')
```

The school-year rollover (`features/setu/rollover/promote-families.ts:319-340`)
pre-creates a fresh next-year enrollment for every returning family with
`status:'active'` and `enrolledVia:'promotion'`. So the day rollover ran, last
year's entire Bala Vihar roster became "active this year" before anyone actually
returned.

**Real UAT data (`chinmaya-setu-uat`, queried 2026-07-12):** of 497 active
`2026-27` enrollments, **493 are `enrolledVia:'promotion'`** (rollover carry-forward)
and only **4 are `family-initiated`**. At the student level, Brampton BV = 594 kids
(590 promotion), Scarborough = 236 (all 236 promotion). This is exactly the
"107 enrolled / 0 arrived" screenshot: those 107 are Level 2's carried-forward roster.

**Second defect (why the split is a correctness fix, not just cosmetics):** on every
autosave, the attendance marker writes **every non-present row as `absent`**
(`components/attendance-marker.tsx:178-180`: *"not tapped = absent"*). With ~100
not-yet-returned students in the main roster, each Sunday's save stamps them all
**Absent** — polluting attendance history for kids who were never expected.

## 2. The rule already exists

Issue #23 (owner decision 2026-07-02) defines "truly enrolled" as
`isEnrollmentConfirmed` (`apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`):

> A `promotion`/`welcome-team` enrollment reads **Registered** until real engagement
> (attended ≥1 class in the year, OR a completed donation tied to its eid, OR a
> legacy-paid roster), at which point it becomes **Enrolled (Confirmed)**. A
> `family-initiated` or `first-attendance` enrollment is Confirmed immediately.

The **family dashboard** (`features/setu/roster/family-engagement.ts`) and **admin
reports** (`features/setu/reports/enrollment-report.ts:deriveBvConfirmedFids`) already
apply this. Only the **teacher roster ignores it.** This design applies the same rule
to the teacher surface, keeping the teacher's "Enrolled" list consistent with the
family's own "Enrolled" badge and the admin reports.

## 3. Goal / Non-goals

**Goal:** The teacher attendance screen shows two lists — a main **Enrolled students**
list (confirmed enrollments only, subject to the stats + auto-absent sweep) and a
secondary **Previous students** panel (active-but-unconfirmed carry-forwards, never
auto-absented). Marking a previous student present confirms their existing family
enrollment; on the next load that student and their siblings surface in their
respective levels' main lists.

**Non-goals / deferred:**
- No enrollment **schema** change, no data **migration**, no rollover change. The
  493 promotion enrollments stay exactly as they are; this is a read-model +
  presentation change.
- No change to the family dashboard, admin reports, or the Visitors flow.
- No denormalized `confirmed` flag on the enrollment doc (considered — see §9).
- Door-self-check-in-only confirmation is out of scope for v1 (see §8 limitation).

## 4. Architecture

Five units change; boundaries stay clean (teacher feature only).

### 4.1 Confirmation helper (new) — `features/setu/teacher/roster-confirmation.ts`
A per-level, bulk helper that, given the level's active enrollments, returns the set
of **confirmed enrollment eids** (or fids), reusing `isEnrollmentConfirmed`. Scoped
to the level's single `pid`, mirroring the proven `deriveBvConfirmedFids` shape:

- **enrolledVia** (`family-initiated` / `first-attendance`) → confirmed immediately.
- **Attendance**: `db.collection('attendanceEvents').where('pid','==',level.pid).get()`
  (top-level collection → single-field auto-indexed; filter `status ∈ {present,late}`
  in memory) → set of attended mids for the year.
- **Donation**: a completed donation in the family's `donations` subcollection whose
  `eid` matches the enrollment's eid. Read within the existing per-fid loop
  (deriveRoster already fans out per family for this one level; bounded ~130 families),
  short-circuited so it's only paid when the cheaper signals are inconclusive
  (same discipline as `family-engagement.ts`).
- **Legacy-paid**: for a legacy-sourced offering, `getLegacyPaymentStatus(legacyFid)`
  (one cached RTDB read serves all).

No new Firestore index required (all single-field/auto-indexed or parent-scoped
subcollection reads); the plan still runs the mandatory index audit (project rule #8).

### 4.2 `deriveRoster` (modify) — `roster.ts`
Returns the roster **split into two arrays**: `members` (confirmed) and
`previousStudents` (active but unconfirmed), both built from the same
enrolled-member matching as today. `buildRoster` gains the confirmed-eid set and
partitions members by their family enrollment's confirmed state. `RosterResult`
gains `previousStudents: RosterMember[]` and `previousTotal: number`; `total`/
`markedCount` continue to describe **only** the confirmed `members`.

### 4.3 `getLevelAttendanceView` (modify) — `level-attendance-view.ts`
Maps the confirmed `members` into `rows` exactly as today (door-seed logic
unchanged) and additionally surfaces `previousStudents` as a lightweight list
(`mid, fid, firstName, lastName, schoolGrade`) plus `previousCount`. The stats
(`presentCount`, `total`) stay scoped to `rows`.

### 4.4 `saveAttendance` (unchanged in scope, verified safe) — `save-attendance.ts`
Because it gates on `deriveRoster().members` (now confirmed-only), the absent-sweep
touches only confirmed students. Previous students are structurally excluded — no
code change needed, but a test pins this invariant.

### 4.5 Confirm-a-previous-student action (new)
- Helper `confirmPreviousStudent(levelId, mid, date, markedBy…)` in
  `features/setu/teacher/` — validates the mid is a *previous* (unconfirmed, matched)
  student of this level, then writes a single `present` attendance event for that
  `mid`+`levelId`+`date` (reusing the `attendanceAid` composite id, `merge:true`).
  It does **not** create or mutate an enrollment doc — the family's active enrollment
  already exists; the present mark confirms it via the `attendedCount > 0` rule.
- Route `POST /api/setu/teacher/attendance/confirm-previous` (under the already
  teacher-gated `/api/setu/teacher/` prefix — no new `canAccessRoute` rule).
  Mirrors the existing attendance route's auth (`readSessionFromHeaders` +
  `isTeacher` + `canTeachLevel`).

### 4.6 UI (modify + new)
- **Attendance marker** (`components/attendance-marker.tsx`): header list relabels
  to **"Enrolled students (N)"**; a **"Previous students (N)"** button sits beside
  "Visitors" (desktop top bar + mobile), hidden when N = 0. Stats strip unchanged
  (already scoped to `rows`).
- **PreviousStudentsPanel** (new, modeled on `VisitorsPanel`): fetch-on-open list of
  previous students, each row with a one-tap **"Mark present"** that calls the
  confirm-previous route, shows a success toast, and on success removes the row
  (optimistic) — the student joins the main list on the next full load. Same row
  styling/avatar as the roster. Empty state when none. A short explainer:
  *"Returning from last year. Mark one present to add their family to this year's class."*
- Reachable at a dedicated route `/teacher/levels/[levelId]/previous`, mirroring the
  existing `/teacher/levels/[levelId]/visitors` page (the "Previous students (N)"
  button navigates there, exactly as "Visitors (N)" navigates to the visitors page).
  A back link returns to attendance, matching the Visitors page.

## 5. Data flow: mark a previous student present

1. Teacher opens **Previous students**, taps **Mark present** on "Aarav Sharma".
2. `POST /api/setu/teacher/attendance/confirm-previous {levelId, mid, date}` writes
   `attendanceEvents/{aid}` `status:'present'` for Aarav.
3. Aarav's family enrollment (already `active`, `enrolledVia:'promotion'`) now has an
   attended mark → `isEnrollmentConfirmed` returns true for the whole enrollment.
4. Next load of this level: Aarav appears in **Enrolled students** (present). His
   sibling on the same enrollment in **Level 5** appears in *that* level's Enrolled
   list (unmarked, now expected). The Previous list no longer shows the family.

## 6. Components / interfaces (summary)

| Unit | Responsibility | Depends on |
|---|---|---|
| `roster-confirmation.ts` (new) | eids confirmed for a level (issue #23 rule, bulk) | `isEnrollmentConfirmed`, attendanceEvents, donations, legacy status |
| `roster.ts` (mod) | split members → confirmed + previous | confirmation helper |
| `level-attendance-view.ts` (mod) | rows (confirmed) + previousStudents view | `deriveRoster` |
| `confirm-previous` helper + route (new) | write present mark for a previous student | `attendanceAid`, `canTeachLevel` |
| `attendance-marker.tsx` (mod) | "Enrolled students (N)" + "Previous students (N)" button | view props |
| `PreviousStudentsPanel` (new) | list + one-tap mark-present | confirm-previous route |

## 7. Auth

Teacher-only throughout. Pages under `/teacher/*` and APIs under `/api/setu/teacher/*`
are already gated (`can-access-route.ts:64,67` → `isTeacher`); admin inherits teacher.
Every new route also re-checks `canTeachLevel(session, levelId)` (defense in depth,
matching the existing attendance route).

## 8. Edge cases & limitations

- **Season-start inversion:** early in the year Enrolled is small and Previous is
  large (~100); it self-heals over the first Sundays. Accepted by owner + Vaibhav.
- **Siblings across levels:** confirming one child confirms the family enrollment, so
  siblings in other levels also move to their Enrolled lists (owner-confirmed intent;
  structural to the one-doc-per-family enrollment model).
- **N=2 discipline:** all read tests use ≥2 confirmed and ≥2 previous students, plus a
  two-sibling family that confirms together (project rule #6).
- **Door-only confirmation (v1 limitation, documented):** a student who *only* ever
  self-checks-in at the kiosk (never teacher-marked, never donated, not legacy-paid)
  stays in Previous until first teacher mark. Same tradeoff the reports helper already
  accepts (`deriveBvConfirmedFids` omits door check-ins to stay bulk). One teacher tap
  resolves it. Revisit if it bites.
- **Future date / read-only past dates:** the Previous-students action respects the
  same future-date guard as the marker (can't mark a class that hasn't happened).
- **Idempotency:** re-marking the same previous student is a `merge` upsert on the
  composite `aid` — no duplicate events.

## 9. Alternatives considered

- **Denormalized `confirmedAt` on the enrollment doc** (write-time flag, trivial
  read-time split). Rejected for v1: needs a backfill migration + updates in every
  confirming write path, more moving parts. The read-time bulk join reuses proven code
  and touches one level (~130 families). Revisit if attendance-page latency regresses.
- **One list with a "Returning · confirm" tag** (Option B from triage). Rejected by
  owner in favor of two lists (Option A) — the stale carry-forwards should be off the
  main list entirely.

## 10. Testing

- **Unit:** `roster-confirmation` (each signal + short-circuit); `deriveRoster` split
  with an N≥2 fixture incl. a two-sibling family; `confirm-previous` writes present +
  never triggers an absent sweep; `saveAttendance` absent-sweep touches only confirmed
  members (pins the correctness fix).
- **Deployed-UAT E2E** (mandatory, project rules #7/#8): a level seeded with ≥2
  confirmed + ≥2 previous students (one a two-sibling family). Assert: main list shows
  only confirmed; Previous button count correct; tapping Mark-present on a previous
  student → on reload that student **and the sibling's level** show them in Enrolled;
  previous students are never written Absent after a normal save. Self-cleaning fixture.
- **Firestore index audit** (rule #8) on every new query shape before ship.

## 11. Mobile

New endpoints under `/api/setu/teacher/*` are mobile-reachable (Bearer + cookie via
`readSessionFromHeaders`), ISO-string JSON, real `md:hidden` mobile layout (the
mockup shows the mobile two-button bar). Any `/api/setu/**` shape change gets a dated,
SHA-keyed entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md`.

## 12. Rollout

Pure code change — no migration, no index, no flag needed (behavior is strictly better
for every level immediately). Ships to `main` per the solo-dev workflow after the
deployed-UAT E2E is green. Runbook §14 gets a dated entry noting the teacher-roster
semantics change (no DB op).
