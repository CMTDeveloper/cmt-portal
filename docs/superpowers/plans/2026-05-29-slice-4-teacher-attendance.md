# Slice 4 — Teacher Views + Attendance (Implementation Plan)

**Date:** 2026-05-29
**Design:** [2026-05-29-slice-4-teacher-attendance-design.md](../specs/2026-05-29-slice-4-teacher-attendance-design.md)
**Owner:** CMT Developer

Each sub-slice is a self-contained vertical: schema → API → UI → tests → commit. TDD: write the
failing test first, run it red, implement until green, commit + push (pre-push hook enforces
`typecheck && lint && test && build`). All Firebase writes target UAT (`chinmaya-setu-uat`); index
deploys are UAT-only, never `--force`, never prod.

## Dependency graph

```
4a (levels + teacher capability) ─┬─► 4c (roster + take attendance) ─┬─► 4d (student detail + safety)
                                  │                                  ├─► 4e (guests + add-student)
4b (class calendar) ──────────────┘                                  ├─► 4f (family attendance surfacing)
                                                                      └─► 4g (welcome/admin read views)
```

- **4a** is the unblocker (levels schema + `teacher` capability + `/teacher/*` gates + admin levels UI + assignment).
- **4b** (calendar) is independent of 4a and can run in parallel; it gates *valid attendance dates* for 4c.
- **4c** is the heart of the slice and needs both 4a (levels + roster) and 4b (today's class date).
- **4d–4g** all build on 4c's `attendanceEvents` model and can run in parallel once 4c lands.

---

## Sub-slice 4a — Levels + teacher assignment + capability

**Goal:** Admin/welcome-team can create/edit Bala Vihar **Levels** (one per location/level/period) in
the admin UI and assign teachers (by `mid` or standalone `tid`). Assignment grants the `teacher`
capability so the sevak's next session can reach `/teacher/*`. A teacher can sign in and see "my levels."

### Files to create
- `packages/shared-domain/src/setu/schemas/level.ts` — `LevelDocSchema`, `LevelKind` enum (`shishu|pre-level|level|parents`), `CreateLevelSchema`, `UpdateLevelSchema`, `levelSlug()` helper, roster-match predicate `memberMatchesLevel(member, level, now)` (pure; grade-band/age/adult logic).
- `packages/shared-domain/src/setu/schemas/teacher.ts` — `TeacherDocSchema` (`tid`), `TeacherAssignmentDocSchema` (`ref`, `levelIds`).
- `packages/shared-domain/src/setu/__tests__/level-schemas.test.ts`
- `apps/portal/src/features/setu/teacher/levels/{create-level,update-level,get-levels,get-my-levels}.ts`
- `apps/portal/src/features/setu/teacher/assignments/{assign-teacher,get-assignment,list-assignments}.ts`
- `apps/portal/src/app/api/admin/levels/route.ts` (GET list + POST create) + `[levelId]/route.ts` (PATCH)
- `apps/portal/src/app/api/admin/teacher-assignments/route.ts` (POST assign — admin **+ welcome-team**)
- `apps/portal/src/app/api/setu/teacher/levels/route.ts` (GET my levels)
- `apps/portal/src/features/admin/levels/levels-table.tsx` (client; mirrors `periods-table.tsx`)
- `apps/portal/src/features/admin/levels/assign-teacher-form.tsx`
- `apps/portal/src/app/admin/levels/page.tsx`
- `apps/portal/src/app/teacher/page.tsx` ("my levels" dashboard) + `layout.tsx` + `error.tsx`
- `apps/portal/scripts/seed-bala-vihar-levels.ts` (+ `seed:bala-vihar-levels` pnpm alias)
- `__tests__` for every route + helper + the table component

### Files to modify
- `packages/shared-domain/src/lib/role-claims.ts` *(actually `apps/portal/src/lib/auth/role-claims.ts`)* — add `'teacher'` to `Capability`.
- `apps/portal/src/features/setu/auth/member-roles.ts` — add `'teacher'` to `GrantableRole` **OR** keep teacher in the separate `teacherAssignments` collection and add a `getTeacherCapability(mid)` read. **Decision: separate collection** (assignments carry `levelIds`), but the *capability* (`teacher` in `extraRoles`) is still computed during session build.
- `apps/portal/src/features/setu/auth/build-session-claims.ts` — after resolving `mid`, check `teacherAssignments/{mid}` (and tid path); if assigned to ≥1 level, add `'teacher'` to `extraRoles`.
- `packages/shared-domain/src/auth/can-access-route.ts` — add, **before the `/api/setu/` catch-all**:
  `/teacher` + `/teacher/*` → `isTeacher`; `/api/setu/teacher/*` → `isTeacher`; `/api/admin/teacher-assignments` → `isAdmin || isWelcomeTeam` (POST).
- `packages/shared-domain/src/setu/index.ts` — export the new schemas.
- `firestore.indexes.json` — `levels (programKey, location, pid, order)` + `levels (teacherRefs ARRAY_CONTAINS, enabled)`.
- `apps/portal/src/components/chrome/` desktop sidebar — accept `role='teacher'` (link set).

### TDD test list
1. `level-schemas`: Create/Update parse; `levelKind` enum; `gradeBand` required for level/pre-level, empty for shishu/parents; `memberMatchesLevel` — child grade ∈ band, shishu by age window from `birthMonthYear`, parents = `type==='Adult'`.
2. `create-level`/`update-level`: slug = `{location}-{levelSlug}-{pid}`; `.create()` 409 on dup; audit fields.
3. admin `levels` route: GET admin-only serialization; POST validation + 201 `{levelId}`; PATCH 404 + partial update.
4. `teacher-assignments` route: POST grants — admin **and** welcome-team allowed, family denied; writes `teacherAssignments/{ref}.levelIds` arrayUnion; pushes `ref` into `levels/{id}.teacherRefs`.
5. `build-session-claims`: a `mid` with a teacher assignment gets `'teacher'` in `extraRoles`; none → no teacher.
6. `can-access-route`: teacher reaches `/teacher` + `/api/setu/teacher/levels`; family blocked; welcome-team can POST `/api/admin/teacher-assignments` but not other `/api/admin/*`.
7. `get-my-levels`: `teacherRefs array-contains ref AND enabled` returns the right levels.
8. `levels-table.test.tsx`: create/edit form posts correct payload; grade-band editor.

---

## Sub-slice 4b — Class calendar (parallel with 4a)

**Goal:** Admin/welcome-team publish a managed school-year calendar (per location) replacing the PDF.
Families see a real "Upcoming" card on `/family` + a full `/family/calendar`. Drives valid attendance
dates for 4c.

### Files to create
- `packages/shared-domain/src/setu/schemas/class-calendar.ts` — `ClassCalendarEntryDocSchema` (`entryId`, `kind`, `classType`, `noClassReason`, `specialEvents`, `shortClass`), `WeeklyScheduleDocSchema`, Create/Update schemas, `entryId = {location}-{date}` helper.
- `apps/portal/src/features/setu/calendar/{create-entry,update-entry,delete-entry,get-calendar,get-upcoming,get-weekly-schedule,set-weekly-schedule}.ts`
- `apps/portal/src/app/api/admin/calendar/route.ts` (GET/POST) + `[entryId]/route.ts` (PATCH/DELETE) + `weekly/route.ts` (GET/PUT)
- `apps/portal/src/app/api/setu/calendar/route.ts` (GET — any signed-in, published only)
- `apps/portal/src/features/admin/calendar/calendar-editor.tsx` (client) + `weekly-schedule-editor.tsx`
- `apps/portal/src/app/admin/calendar/page.tsx`
- `apps/portal/src/app/family/calendar/page.tsx` (+ `error.tsx`)
- `apps/portal/scripts/seed-bala-vihar-calendar.ts` (Brampton 2025-26 from the PDF) + pnpm alias
- `__tests__` for routes + helpers + editor + family calendar page

### Files to modify
- `packages/shared-domain/src/auth/can-access-route.ts` — `/api/setu/calendar` GET any signed-in family; `/api/admin/calendar` admin **+ welcome-team**; `/family/calendar` already covered by `/family/*`.
- `packages/shared-domain/src/setu/index.ts` — export schemas.
- `firestore.indexes.json` — `classCalendarEntries (location, date)`.
- `apps/portal/src/app/family/page.tsx` — replace the hardcoded "Upcoming" / "Sample data — real data coming soon" card with `getUpcoming(location)` data.

### TDD test list
1. `class-calendar-schemas`: kind/classType invariants (classType required when kind=class, null when no-class; noClassReason inverse); `entryId` helper.
2. calendar routes: admin+welcome write, family read-only published; PATCH/DELETE 404; weekly GET/PUT.
3. `/api/setu/calendar` GET: returns only `enabled:true` entries for the requested location, sorted by date; rejects unsigned.
4. `get-upcoming`: next `class` entry ≥ today (Toronto), no-class notices, special events.
5. family `/family/calendar` page: renders entries grouped by month + weekly header.
6. dashboard Upcoming card uses real data (no "Sample data" string).

---

## Sub-slice 4c — Roster + take attendance (the heart)

**Goal:** A teacher opens a level on Sunday, sees the derived roster + existing marks, taps
present/absent/late per student, saves (idempotent batch), and first-attendance auto-enrolls the family.

### Files to create
- `packages/shared-domain/src/setu/schemas/attendance.ts` — `AttendanceEventDocSchema`, `AttendanceStatus` (`present|absent|late`), `aid = {levelId}-{mid}-{date}` helper, `AttendanceMarksSchema` (`Record<mid,status>`).
- `apps/portal/src/features/setu/teacher/roster/derive-roster.ts` — §6 logic: enrolled families at level location/pid → match members by `levelKind` → merge `attendanceEvents` for date → `unaccounted` derived.
- `apps/portal/src/features/setu/teacher/attendance/{save-attendance,get-attendance-for-level}.ts` — batched upsert by composite `aid`; wires `enrollFamilyOnFirstAttendance` when a marked child's family lacks an active enrollment.
- `apps/portal/src/app/api/setu/teacher/levels/[levelId]/roster/route.ts` (GET `?date=`)
- `apps/portal/src/app/api/setu/teacher/attendance/route.ts` (POST)
- `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` (three-state, sticky "X/Y marked · Save", optimistic) — re-implement the legacy UX against Setu types.
- `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx`
- `__tests__` for roster derivation (all 4 kinds + edge cases), save (idempotent, auto-enroll), assignment guard, marker component.

### Files to modify
- `firestore.indexes.json` — `attendanceEvents (levelId, date)`, `(mid, date)`, `(fid, date)`.
- `packages/shared-domain/src/setu/index.ts` — export attendance schema.

### TDD test list
1. `attendance-schemas`: status enum; `aid` composite; marks record parse.
2. `derive-roster`: level kind matching (grade band, shishu age, parents adults); merges existing marks; `unaccounted` for matched-but-unmarked; edge cases (grade matches no level → flagged; blank grade).
3. `save-attendance`: composite `aid` upsert is idempotent (re-mark overwrites, no dupe); batch write; **teacher must be assigned to levelId** (403 otherwise); auto-enroll fires once when family has no active enrollment for pid; `markedByUid`/`markedByMid` audit.
4. roster route: assigned teacher 200, unassigned teacher 403, family 403; date defaults to today Toronto.
5. marker component: three-state toggle, marked-count, save posts `{levelId,date,marks}`, optimistic + error revert.

---

## Sub-slice 4d — Student detail + safety banner
- `/teacher/students/[mid]` read view: attendance % + heatmap for the period, parent contact (tap-reveal), **always-visible allergy + emergency-contact banner** (`foodAllergies` + `emergencyContacts` via the existing `AllergyCallout` pattern).
- `GET /api/setu/teacher/students/[mid]` — teacher must teach a level the student is in.
- Tests: banner always renders; non-teaching teacher 403; attendance % math.

## Sub-slice 4e — Guests + add-student-on-prompt
- `/teacher/levels/[levelId]/guests` + `POST /api/setu/teacher/guests` (mark `isGuest:true`).
- Add-student sheet → creates pending member + fires Slice 2d invite + marks child present (guest); "pending invite" badge.
- Reuses `POST /api/setu/invite/send`. Tests: guest event `isGuest:true`; add-student creates member + invite + guest mark atomically.

## Sub-slice 4f — Family-side attendance surfacing
- Wire `/family` dashboard attendance stat + `/family/members/[mid]` attendance card to real `attendanceEvents (fid/mid)` — replace `"with check-in soon"` / `"attendance tracking arrives…"` placeholders.
- `getAttendanceForFamily(fid)` + `getAttendanceForMember(mid)` helpers.
- Tests: real counts; member card renders marks; placeholder strings gone.

## Sub-slice 4g — Welcome-team/admin read views
- `/welcome/levels` + `/welcome/levels/[levelId]` (roster + attendance read) and admin equivalents; "unassigned students" view (children whose grade matches no level at their location).
- `GET` reuses teacher roster/attendance helpers with a welcome-team/admin gate.
- Tests: welcome-team read access; unassigned-students query.

---

## Cross-cutting verification (don't skip — CLAUDE.md pre-ship rules)
- After unit-green, walk the real flow in UAT: seed levels + calendar, assign a teacher (test family `CMT-P672RGSS`), sign in as that teacher, take attendance, confirm `attendanceEvents` docs + auto-enroll snapshot in UAT Firestore, then confirm the family dashboard shows the marks.
- Teacher capability is security-critical: ship the `can-access-route` + `build-session-claims` tests in the **same commit** as the wiring.
- Deploy new indexes to UAT only.
