# Slice 3 — Admin / Teacher polish — Design

> Third and final slice from the 2026-07-06 polishing call. A cohesive batch of
> admin + teacher refinements to the Bala Vihar level / teacher / attendance
> surfaces. One spec, one plan, five independently-testable workstreams (A–E).

**Status:** Draft — awaiting owner review. The owner was away during the
clarifying questions, so the three open decisions below are set to the
**recommended** option. Every one is reversible and called out inline so the
owner can flip it at spec review.

**Prerequisite discipline:** the two *bug* workstreams (A's collision fix, E's
rollover fix) MUST begin with a read-only reproduction against deployed UAT
(`chinmaya-setu-uat`) — read the ACTUAL error/state before writing the fix (firm
project directive; `reproducing-setu-bugs-in-uat` skill). The fixes below are
code-backed hypotheses; the implementer confirms them against real data first
and adjusts if the real cause differs.

---

## Goal

Polish the admin level-management + teacher-assignment + attendance surfaces so
they match how CMT actually runs Bala Vihar:

1. **Levels** — school grades picked from a **dropdown** (3K / JK / SK / 1–12),
   not free text; drop the redundant free-text "Age / grade label" field; fix a
   level-name collision bug.
2. **Teacher assignment** — assign teachers **per level, inline**, searching by
   **name** (email shown to disambiguate), with assigned teachers rendered as
   removable **name pills**; delete the separate "Teacher assignments" tab.
3. **Attendance** — **Present / Absent only** (retire Late + Uninformed).
4. **Guest-add** — the in-class visitor "Grade" field becomes a **dropdown**.
5. **Rollover** — fix the "teacher list empty after rollover" bug.

## Non-goals

- No data migration of historical attendance (`late` / `uninformed` events stay
  as-is and remain readable).
- No change to the promotion ladder (`GRADE_LADDER` untouched — see Decision 2).
- No new feature flag (these refine existing admin/teacher screens; kept small,
  revertible, and covered by deployed-UAT E2E).
- Standalone teacher-only sevaks (`tid` refs) are out of scope for the new
  name-search UI — assignment resolves to registered member `mid`s exactly as
  today's email flow does.

---

## Open decisions (owner-reversible; set to recommended)

### Decision 1 — Attendance blast radius → **Purge `late` from all write + display paths; tolerate on read**

The *live* Setu teacher marker (`/teacher/levels/[levelId]/attendance`) is
**already binary Present/Absent** — its own comment says *"Late is retired from
teacher attendance."* `late` still lives in:
- the write/validation schema `SETU_ATTENDANCE_STATUSES = [present, absent, late]`,
- the reports (`attendance-report.ts` late column, `enrollment-report.ts` counts
  late as engaged, `report-csv.ts` late column),
- the **separate, still-live legacy** `/check-in/teacher` screen (4-state
  present/absent/late/**uninformed**, its own `ATTENDANCE_STATUSES` enum in
  `check-in/attendance.ts`).

**Recommended (this design):** binary end-to-end, done **safely**:
- **Writes** accept only `present` / `absent` (narrow the save + guest write
  schemas). Historical `late` events are **still valid on read** — the doc-read
  schema stays tolerant, so nothing 500s (`feedback_zod_doc_schema_read_validation_min`).
- **Reports** fold `late` → `present` (present count absorbs former late) and
  drop the separate `late` column from the report model + CSV. `enrollment-report`
  already treats late as engaged → behavior unchanged, just no separate surface.
- **Legacy `/check-in/teacher`** attendance UI simplified to present/absent
  (drop the Late + Uninformed radios); its status badge stays tolerant for
  historical display.

*Alternatives (reversible):* (b) leave reports + legacy untouched, treat as
done; (c) both teacher UIs binary but keep `late` in schema + reports.

### Decision 2 — "3K" → **New grade token, UI-only (not in the promotion ladder)**

Today the canonical sets are `GRADE_LADDER = [JK, SK, 1…12]` (drives promotion)
and the profile form's `GRADE_OPTIONS = [Shishu, JK, SK, 1…12]`. No `3K` exists.

**Recommended:** introduce `3K` (age-3 preschool) as a new grade token available
in **three pickers**: the level grade-band multi-select, the guest-add grade
select, and the child school-grade select (so a level's `3K` band actually
matches a `3K` child). `3K` is **deliberately excluded from `GRADE_LADDER`**, so
school-year promotion is unchanged — a `3K` child is `needs-grade` at rollover
and gets a grade set manually, exactly like today's Shishu bucket. No
rollover/promotion code changes.

*Alternatives (reversible):* (b) `3K` is just shorthand for the existing
"Shishu" option — no new token; (c) add `3K` to `GRADE_LADDER` too (heavier —
touches promotion + grade editor).

### Decision 3 — Level-name collision → **Enforce normalized-name uniqueness within (location, period)**

A level's doc id is **frozen at create** as `{location}-{levelSlug}-{pid}`
(`levelIdFor`). The create path relies on Firestore `.create()` throwing (code 6)
→ `level-conflict`. But:
- A **rename** (`PATCH`) writes `levelName` on the **same** frozen id and does
  **no** collision check → two levels in the same location+period can end up
  displaying the **same name** (their ids were slugged from the *old* names).
- Two genuinely-different names that slug identically also collide only by luck
  of the id.

**Recommended:** add an explicit **normalized-name uniqueness check within
(location, pid)** at both create and rename — read the period's levels with a
single `where('pid','==',pid)` query, filter location in memory (no new index),
reject if another level's `normalizeGrade`-style normalized name matches. Return
`level-conflict` with a clear message. Reproduce the owner's exact symptom in
UAT first.

*Alternatives (reversible):* (b) an over-eager error blocks a legit create; (c)
same name at different locations is wrongly rejected. Repro decides.

---

## Global constraints (bind every task)

- **UAT only** — all DB ops / index checks / E2E target `chinmaya-setu-uat`;
  never touch prod `715b8`; never `--force` an index deploy.
- **`@cmt/shared-domain` stays pure** — no React/Next/Firestore; new grade const +
  `levelGradeSummary()` live there as pure TS.
- **`exactOptionalPropertyTypes` on** — omit optionals / use `null`, never assign
  `undefined`.
- **Doc-read schemas validate on read** — never tighten a stored-doc field's enum
  in a way that rejects historical values; enforce narrowing at write routes/forms.
- **Role checks via helpers** — `isAdmin` / `isWelcomeTeam`, never `role === …`.
- **canAccessRoute** — every new `/api/**` path gets an explicit rule; `/api/setu/*`
  additions precede the manager-only catch-all; confirm `/api/admin/*` gating.
- **No new Firestore composite indexes** — bulk `collectionGroup` reads + in-memory
  joins/filters (`feedback_bulk_collectiongroup_over_per_family_fanout`,
  `auditing-firestore-indexes`).
- **Mobile contract** — any `/api/setu/**` request/response/enum change appends a
  dated, SHA-keyed `apps/portal/docs/MOBILE_API_CHANGELOG.md` entry. `/api/admin/*`
  is **not** part of the mobile contract.
- **Every user-facing surface gets a deployed-UAT Playwright E2E** with a realistic
  fixture (`feedback_playwright_e2e_every_feature`).
- **Runbook** — any UAT DB op / script / behavior change updates
  `docs/runbooks/production-cutover-checklist.md` + a dated §14 entry the same turn.
- **N=2 discipline** — after any one→many read change (e.g. multiple teachers per
  level, multiple levels per teacher), exercise the read with **two**.

---

## Shared building blocks (built once, used across workstreams)

### `SCHOOL_GRADE_PICKER` (new, `@cmt/shared-domain/setu/grades`)

```ts
// Canonical, ordered grade options for ALL grade pickers (level band, guest-add,
// child profile). Pure data. '3K' is a real, matchable grade token but is NOT a
// GRADE_LADDER rung (promotion leaves it as needs-grade — see Decision 2).
export const SCHOOL_GRADE_PICKER: readonly { value: string; label: string }[] = [
  { value: '3K', label: '3K (age 3)' },
  { value: 'JK', label: 'JK' },
  { value: 'SK', label: 'SK' },
  ...['1','2','3','4','5','6','7','8','9','10','11','12'].map((g) => ({ value: g, label: `Grade ${g}` })),
];
export const SCHOOL_GRADE_VALUES = SCHOOL_GRADE_PICKER.map((g) => g.value); // ['3K','JK',…,'12']
```

The child profile form's existing `GRADE_OPTIONS` keeps its `Shishu (younger than
JK)` age-bucket entry and appends the picker (or is rebuilt from it + Shishu) so
`3K` becomes selectable there too.

### `levelGradeSummary(level)` (new, `@cmt/shared-domain/setu/schemas/level`)

```ts
// Human display label for a level, derived from its kind + gradeBand — replaces
// the removed free-text ageLabel. Pure.
//   level/pre-level → "JK, SK" | "Grades 2, 3"     shishu → "Shishu"     parents → "Parents"
export function levelGradeSummary(level: Pick<LevelDoc,'levelKind'|'gradeBand'>): string { … }
```

### `getBvTeacherNames(levelIds)` (existing — reuse)

Already resolves each level's `teacherRefs` (mids) → display names via a bulk
`collectionGroup('members').where('mid','in',…)` read (index already deployed).
Reused server-side to render the per-level teacher **pills**.

### `assignTeacher({ ref, levelIds, byUid })` (existing — reuse as the single writer)

Idempotently sets a teacher's **full** level set and syncs each level's
`teacherRefs` (arrayUnion/arrayRemove) in one batch. **All** teacher writes
(per-level add/remove in B, rollover carry-forward in E) route through this so
the two sources of truth — `teacherAssignments/{ref}.levelIds` and
`levels/{id}.teacherRefs` — never diverge.

---

## Workstream A — Level grade dropdown + remove age label + collision fix

**Files:**
- `packages/shared-domain/src/setu/grades.ts` (new — `SCHOOL_GRADE_PICKER`).
- `packages/shared-domain/src/setu/schemas/level.ts` — add `levelGradeSummary()`;
  make `ageLabel` **optional** in `LevelDocSchema` / `CreateLevelSchema` /
  `UpdateLevelSchema` (tolerant read; new docs may omit it).
- `apps/portal/src/features/admin/levels/levels-table.tsx` — grade **multi-select**
  (checkbox chips of `SCHOOL_GRADE_PICKER`, gated to `level`/`pre-level` kinds);
  **remove** the "Age / grade label" input; table/card show `levelGradeSummary`.
- `apps/portal/src/app/api/admin/levels/route.ts` (POST) + `[levelId]/route.ts`
  (PATCH) — normalized-name uniqueness check within (location, pid); stop
  requiring `ageLabel`.
- Consumers of `ageLabel`: `app/teacher/page.tsx`, the Setu attendance-marker
  header, and any level display → switch to `levelGradeSummary(level)`.

**Behavior:**
- Grade band is chosen from the dropdown (multi-select for level/pre-level; the
  band is `[]` for shishu/parents as today). Stored `gradeBand` values are the
  picker `value`s (`3K`,`JK`,`SK`,`1`…`12`) — these already normalize-match child
  `schoolGrade` via `memberMatchesLevel` / `normalizeGrade`.
- `ageLabel` is no longer collected. Existing docs keep it (harmless). Display is
  derived. `CreateLevelSchema.ageLabel` becomes optional; the POST writes it only
  if present.
- **Collision (Decision 3):** single `where('pid','==',pid)` read, filter
  location in memory, reject a create/rename whose normalized name equals another
  level's in the same (location, pid). `level-conflict` (409) with clear copy.

**Tests:** `levelGradeSummary` unit table; schema optional-`ageLabel`; POST/PATCH
collision (create dup name → 409; rename to existing → 409; same name different
location → OK; N=2 levels in a period). Deployed-UAT E2E: create a level via the
grade dropdown, confirm it persists + displays the derived grade label.

---

## Workstream B — Teacher assignment revamp (inline, per-level, name search)

**Files:**
- `apps/portal/src/app/api/admin/teachers/search/route.ts` (new) —
  `GET ?q=` → admin **and** welcome-team. Resolve by **name** reusing the family
  `searchFamilies` (family `searchKeys` array-contains, index already deployed):
  find matching families, surface their **adult** members as
  `{ mid, name, email }`, dedupe, cap ~10. Email is returned to disambiguate
  same-named people. No new index.
- `apps/portal/src/app/api/admin/levels/[levelId]/teachers/route.ts` (new) —
  `POST { mid }` add / `DELETE { mid }` remove. Admin **and** welcome-team;
  writable-year gated. Reads the teacher's current `levelIds`, unions/subtracts
  this `levelId`, calls `assignTeacher` (keeps both sources in sync). Rejects a
  non-existent level (`findMissingLevelIds`).
- `apps/portal/src/app/admin/levels/page.tsx` — resolve `getBvTeacherNames` for
  the viewed levels; pass `teacherNames: Map<levelId, {mid,name}[]>` into the table.
- `apps/portal/src/features/admin/levels/levels-management.tsx` — **delete the tab
  strip**; render the levels table directly (keep `readOnly`).
- `apps/portal/src/features/admin/levels/levels-table.tsx` — each level row shows
  **removable name pills** + an **"Assign teacher"** control opening a small
  **name-search popover** (type → results with email → click assigns). Optimistic
  update of the row's pills.
- **Delete** `assign-teacher-form.tsx` (the old email-centric tab form) and its tests.
- Keep `POST /api/admin/teacher-assignments` (still used by the level-create
  `teacherEmail` path) — only the tab UI is removed.

**canAccessRoute:** add explicit rules for `/api/admin/teachers/search` and
`/api/admin/levels/[levelId]/teachers` (admin + welcome-team), matching the
existing `/api/admin/teacher-assignments` gate.

**Tests:** search route (name hit returns adults + email; welcome-team allowed;
non-admin/non-welcome 403); per-level add/remove (union/subtract correct; both
`teacherAssignments` + `teacherRefs` synced; N=2 teachers on one level, N=2
levels on one teacher). Deployed-UAT E2E: search a seeded teacher by name, assign
to a level, see the pill, remove it.

---

## Workstream C — Attendance Present / Absent only

**Files:**
- `packages/shared-domain/src/setu/schemas/attendance.ts` — introduce a
  **write** set `SETU_ATTENDANCE_WRITE_STATUSES = [present, absent]` used by
  `SaveAttendanceSchema.marks` + `MarkGuestSchema.status`. `AttendanceEventDoc`
  `status` **stays tolerant** of `late` on read (historical). (Same pattern for
  the legacy `check-in/attendance.ts` if needed for the legacy screen.)
- `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` —
  already binary; keep the `late→present` seed (historical), drop any residual
  `late` write.
- `apps/portal/src/features/check-in/teacher/attendance-marker.tsx` (legacy) —
  simplify the 4 radios to present/absent; `attendance-status-badge.tsx` stays
  tolerant for historical display.
- Reports — `attendance-report.ts` / `report-csv.ts`: fold `late` into `present`
  (drop the `late` tally + column). `enrollment-report.ts` already counts late as
  engaged → unchanged.
- Guest write path (`features/setu/teacher/guests.ts`) — status constrained to
  present/absent via `MarkGuestSchema`.
- `MOBILE_API_CHANGELOG.md` — dated entry: `/api/setu/teacher/attendance` +
  `/api/setu/teacher/guests` now accept only `present`/`absent`; mobile must stop
  sending `late`.

**Tests:** write schema rejects `late` (400); reports fold late→present with an
N=2 fixture containing a historical `late` event (present count absorbs it, no
`late` column); legacy marker renders 2 radios. Deployed-UAT E2E: mark a class
binary, save, reload → persisted.

---

## Workstream D — Guest-add grade dropdown

**Files:**
- `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx` — replace
  the free-text "Grade" `<input>` with a `<select>` of `SCHOOL_GRADE_PICKER` plus
  a blank "—" (grade stays optional). `AddVisitorSchema.schoolGrade` is already
  `nullable` — unchanged.

**Tests:** panel renders the select; submitting a chosen grade posts it;
blank → `null`. Covered by the visitors E2E path.

---

## Workstream E — Teacher-list-empty-after-rollover fix

**Repro first (read-only UAT):** confirm the symptom — after a start-new-year +
activate, new-year levels carry `teacherRefs: []`, and/or `teacherAssignments`
is out of sync with `levels.teacherRefs`, so `getMyLevels` (teacher "My classes")
and the admin per-level pills read empty.

**Root cause (hypothesis, code-backed):** `prefillTeachers`
(`/api/admin/school-year/copy-teachers`, the opt-in Step-3 helper) copies source
`level.teacherRefs` → target `level.teacherRefs` **but never updates**
`teacherAssignments/{ref}.levelIds`. The two sources of truth diverge, and a
skipped copy-teachers leaves everything empty.

**Files:**
- `apps/portal/src/features/setu/rollover/prefill-teachers.ts` — for each
  carried-forward ref, also **sync `teacherAssignments`** by routing through
  `assignTeacher` (union the target levelIds into the ref's set) so `getMyLevels`,
  the `teacher` capability, and the admin pills all populate. Stay idempotent +
  never clobber a deliberate target assignment.
- Rollover readiness UI (`features/setu/rollover/…year-readiness…`) — surface
  copy-teachers as a **recommended** step so it isn't silently skipped (exact
  surface confirmed after repro).

**Tests:** `prefill-teachers` unit — after prefill, BOTH `levels.teacherRefs` and
`teacherAssignments.levelIds` contain the target levelIds; idempotent re-run;
never clobbers an existing target assignment; N=2 teachers carried forward.
Deployed-UAT E2E (or a scripted repro→fix→verify): after a rollover, a seeded
teacher's "My classes" shows the new-year level.

---

## Sequencing & shared risk

Suggested order: **A → D → C → B → E** (A ships the shared grade const that D
reuses; C is self-contained; B is the largest build; E depends on nothing but
wants A's `levelGradeSummary` for its verification screens). Each workstream is
independently reviewable and testable.

Highest blast radius: **C** (touches the live legacy kiosk + reports + mobile
contract) and **B** (new endpoints + tab removal). Both get realistic multi-
instance deployed-UAT E2E before "done."

## Verification status convention

End-of-task summaries distinguish "tests pass" from "end-to-end verified in
UAT." The two bug fixes (A-collision, E-rollover) are not "done" until the real
symptom is reproduced pre-fix and confirmed gone post-fix against deployed UAT.
