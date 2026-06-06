# Teacher Attendance (redesign + door-data reuse) — design

**Date:** 2026-06-06
**Status:** Approved direction (CMT Developer, 2026-06-06 brainstorming). Umbrella spec; to be built slice by slice (each slice gets its own plan).

## Goal

Give Bala Vihar teachers a **native portal experience** to take attendance for the kids in their level — including **visitor/guest children** who show up — without losing the check-in data families already produce at the ashram door. Today teachers do this in the standalone `chinmaya-family-check-in` app (binary present, any-teacher-any-level); families self-check-in at the door kiosk; and walk-in guests fill a guest form. The portal will become the **go-forward source of truth** for attendance (richer present/late/absent), while **reusing the door app's live data** so the two run in parallel and nothing is lost.

Driving teacher pain (verbatim from CMT Developer):
1. Teachers can't easily see **new/visitor kids** in their class; the door's guest check-in captures them but teachers have no view of it.
2. Visitor parents sometimes haven't done a proper guest check-in (or don't know the grade); teachers need to **add a visitor child quickly** before taking attendance (name now; parent email/grade can come later).
3. Teachers need to **mark attendance for enrolled BV kids in their specific level** — the thing they do in the door app today — available in the portal.

## Locked decisions (from brainstorming)

- **Fresh UX redesign** of the teacher attendance screens (mobile-first, native, on-theme), **reusing the proven portal data layer** (`LevelDoc`s, enrollment-gated rosters, `attendanceEvents`, teacher assignment) rather than rebuilding it.
- **Source of truth = portal `attendanceEvents`** with **present / late / absent** (3-state). Door check-ins map to "present"; teachers can refine.
- **Reuse door data via live read-through**, not a copy. A read-only bridge reads the door app's Firestore collections; the portal merges them into the teacher + family views on the fly. (Full migration/backfill into the portal store is a **later phase**, toward retiring the door app at kiosk cutover.)
- **v1 includes the family-facing side**: the family dashboard + child profile show the **union** of teacher marks and door check-ins (consistent attendance everywhere), not just the teacher experience.
- **Visitor children**: surfaced on the teacher's roster from the door's guest check-ins (matched to a level by grade), **plus** an in-class quick-add for walk-ins who skipped the door. Name required; grade + parent email optional (can be filled later).

## The Firebase topology (the crux) and the bridge seam

Two Firestore datasets are in play:
- **Door app** (`chinmaya-family-check-in`) writes to **prod `chinmaya-setu-715b8`** Firestore: `family-check-ins/*` and `guest-families/*`.
- **Portal** writes its own data (`attendanceEvents`, `families`, `levels`, …). **Today** the portal's Firestore is **`chinmaya-setu-uat`** (testing); **later** the portal will run on the **same prod `715b8`** account as the door app (CMT Developer, 2026-06-06). The portal already has a **read-only master RTDB** bridge to `715b8` for the legacy roster — but **no Firestore bridge** to `715b8` yet.

**Design the door-data access as ONE seam** so the UAT→prod move is a config flip, not a rewrite:

```
checkInSourceFirestore(): Firestore   // READ-ONLY handle to the door app's Firestore
```
- **Now (portal on UAT):** returns a Firestore client on the **master app** (`getFirestore(getMasterApp())`, project `715b8`) — a NEW read-only helper mirroring the existing `masterRtdb()`. Reads only; we never write `family-check-ins`/`guest-families`.
- **Later (portal on `715b8`):** `checkInSourceFirestore()` returns the **portal's own** Firestore (same project) — the bridge collapses to a same-project read. No reader code changes; only the seam's wiring changes.

**Hard rules:** the bridge is **read-only** — the portal NEVER writes the door's `family-check-ins`/`guest-families` (it writes its own `attendanceEvents`). This honours the standing "never write prod `715b8`" rule. Requires the master service account to have **Firestore read** permission on `715b8` (infra prerequisite to confirm).

> Note: the portal's existing `getCheckInAttendance()` reads `family-check-ins` via `portalFirestore()` (UAT) — which is empty of real door data today. This redesign **re-points all door reads through `checkInSourceFirestore()`** so the portal actually sees live door check-ins.

## Door app schema (confirmed from `/Users/dineshmatta/projects/chinmaya-family-check-in`)

- **RTDB `roster`** (read-only master, `715b8`): array indexed by `sid`; `{ sid, fid, fname, lname, grade, level (string e.g. "Level 1 (Gr 1)"), classid, payment ("Paid"|"Unpaid"), pemail, … }`. Parents = `grade === 99`. Already read by the portal via `masterRtdb()`.
- **Firestore `family-check-ins/{fid}/checkIns/{YYYY-MM-DD}`**: `{ date, students: [{ sid, isCheckedIn: boolean, timestamp }], checkedInBy?, timestamp }`. **Binary** present; **both** family self-check-in **and** the door's teacher attendance write here. (Legacy variant: `students` as a `{sid: bool}` map — readers must tolerate both.)
- **Firestore `guest-families/{emailLower}` + `/checkIns/{YYYY-MM-DD}`**: `{ date, parentName, phone, email, children: [{ name, grade, isCheckedIn: true }], timestamp }`. Per-child **name + grade**, **no per-child id, no level, no fid/sid**.
- **Dates** are `America/New_York` `YYYY-MM-DD`; classes are **Sundays**. (Toronto and New York share the Eastern offset, so the portal's `torontoToday()` date key aligns with the door's date key — no conversion needed.)

## Portal data layer (reused as-is)

- **`attendanceEvents/{aid}`** (`aid = ${levelId}-${mid}-${date}`): `{ aid, levelId, mid, fid, pid (=offering id), date, status: present|late|absent, isGuest, markedByUid, markedByMid, markedAt, updatedAt }`. The go-forward source of truth (UAT now → `715b8` later). One row per student per class-day; idempotent upsert.
- **`LevelDoc`**: `levelId, programKey, location, levelName, levelKind (shishu|pre-level|level|parents), gradeBand[], ageLabel, pid, teacherRefs[], enabled`. `memberMatchesLevel(member, level)` places a child by grade-band (or shishu-age, or adult). Rosters are **enrollment-gated** (`deriveRoster`: active enrollment for `level.pid` at `level.location` + member match).
- **Teacher↔level scoping**: `teacherAssignments/{ref}` + denormalized `levels.teacherRefs[]`; `getMyLevels(mid)`. (We KEEP portal scoping — better than the door app's any-teacher-any-level — admin/welcome assign teachers to levels via the existing `/api/admin/teacher-assignments` + form.)
- **Identity bridge**: portal family `legacyFid` + member `legacySid` link to the door roster + `family-check-ins`. (Populated by the legacy-family migration; the family dashboard already uses it.)

## Architecture (one paragraph)

A read-only `checkInSourceFirestore()` seam exposes the door app's `family-check-ins` + `guest-families` to the portal. A **unified attendance resolver** merges, per (kid, date): the portal `attendanceEvents` mark (wins) → else a door self-check-in (→ present) → else unaccounted. Teachers get a **redesigned, mobile-first** level-attendance screen: the enrollment-gated roster with present/late/absent toggles (pre-filled from the resolver so door check-ins already show), a **Visitors** section listing the day's `guest-families` children whose grade matches the level (plus an in-class quick-add), and a save that writes `attendanceEvents` (the truth). The **family dashboard + child profile** read the same resolver so families see the union of teacher marks and door check-ins. All teacher write APIs stay mobile-app-ready (`readSessionFromHeaders`, ISO JSON, shared Zod). A **later migration phase** backfills the door history into `attendanceEvents` so the portal becomes the sole store and the door app can retire at kiosk cutover.

## Teacher experience (redesigned, v1)

- **`/teacher`** — "My classes": the levels I'm assigned to (existing `getMyLevels`), each linking to its attendance screen. Mobile-first cards.
- **Level attendance** (`/teacher/levels/[levelId]/attendance`, redesigned):
  - **Date**: defaults to the most-recent **Sunday** (BV class day); a date control (Sunday-constrained, with an "all dates" escape hatch for admins/makeups).
  - **Roster**: enrollment-gated + grade-matched kids. Each row shows the **resolved status** (present/late/absent/unaccounted) pre-filled from the resolver — so a kid who self-checked-in at the door already reads "present (door)" and the teacher can confirm or change to late/absent. A clear visual marks the source (door vs teacher).
  - **Visitors section**: the day's `guest-families` children whose `grade` matches this level's `gradeBand` (at this location), shown as confirmable "checked in at door" rows; **plus** an **Add a visitor** quick-add (name required; grade + parent email/phone optional). Confirming/adding creates the pending-family record (existing `add-student` pattern — parent later claims it by signing in) and marks the child present.
  - **Save** → upsert `attendanceEvents` (present/late/absent, `isGuest` flag for visitors). Idempotent; re-saving updates.
  - Safety: allergy/emergency indicators on rows (existing pattern).
- **Student detail** (`/teacher/students/[mid]`) — unchanged except its attendance now reflects the unified resolver (door + portal).

## Family-facing reconciliation (v1)

- The **child profile** per-program attendance and the **family dashboard** BV card read the **unified resolver** instead of the door-only `getCheckInAttendance`. Result = union of portal `attendanceEvents` (present/late/absent) and door self-check-ins (present), portal winning per date. So a family sees what the teacher marked AND their own door check-ins, consistently.
- BV's `attendanceMode` handling: introduce a **unified BV attendance reader** used by both teacher and family surfaces; the child-profile attendance branch for BV uses it. (Whether BV's `attendanceMode` flips `'check-in'`→`'teacher'` or stays `'check-in'` with a union reader is an implementation detail resolved in the plan; the user-visible behavior is the union.)
- N≥2 safety (MEMORY trap): the BV-bespoke surfaces must keep selecting by `programKey` (`selectBalaViharEnrollment`) — the resolver is scoped to the BV level/offering window.

## Visitor / guest-child handling (detail)

- **Pre-confirm display** (no portal record yet): a door guest child is only `{ name, grade, parentEmail, date }` — no id/fid/sid. On a teacher's level roster we show door guests whose `normalizeGrade(grade)` ∈ the level's `gradeBand`, at the teacher's location. (The door doesn't record location; we assume the teacher's level location — acceptable for the single-ashram BV case; documented assumption.)
- **On confirm / quick-add** → reuse the existing `addStudentOnPrompt` pattern: if the parent email maps to an existing family (via `contactKeys`), append the child; else create a **pending family** (`name "{lastName} family"`, pending manager member with the parent email/phone, the child member, `contactKeys`) so the parent claims it on next OTP sign-in. Then write the `attendanceEvents` mark (`isGuest: true`) and first-attendance auto-enroll for the level's offering.
- **Grade unknown**: allowed — the child is still marked present in **this** level (the teacher is standing in it); they just won't auto-match a level elsewhere until a grade is set. **Parent email optional** for quick-add (relax today's required-email): a nameless-contact visitor is still recorded against the level for the day; contact can be added later. (Confirm: relaxing email-required is desired — the brainstorming said "if teachers get parents' email they can add"; so email optional, not required.)

## API surface (mobile-app-ready)

- Reuse/extend the teacher attendance + guests + add-student routes under `/api/setu/teacher/*` (all `readSessionFromHeaders` + `isTeacher` + `canTeacherSeeStudent`/`canTeachLevel` roster gates; ISO JSON; shared `@cmt/shared-domain` Zod). New/changed:
  - The level-attendance GET returns the **resolved roster** (enrolled + door-overlay status) + the **door visitors** for the date.
  - The save POST writes `attendanceEvents` (present/late/absent).
  - The visitor confirm/add POST creates the pending family + marks.
- No `canAccessRoute` change expected (the `/api/setu/teacher/` catch-all already gates on `isTeacher`); add confirming tests.

## Access & security

- Teacher routes gated by `isTeacher` (admin inherits) + per-level/per-student roster checks (`canTeachLevel`, `canTeacherSeeStudent`). Portal keeps teacher→level scoping (door app didn't).
- The door-data bridge is **read-only**; never writes `715b8`. Master service account needs Firestore **read** on `715b8`.
- Visitor add creates pending families with the same anti-theft `contactKeys` discipline as the existing add-student flow.

## Cross-cutting (standing rules)

- **Mobile-app readiness**: every handler `readSessionFromHeaders` (cookie OR Bearer), ISO JSON, shared schemas; every teacher screen has a real mobile (`block md:hidden`) + desktop layout — teachers are on phones in class, so **mobile is primary**.
- **On-theme UX**: Cool-Mist tokens, `CspRoot`/`.csp` scoping, designer pass on the new teacher screens.
- **Role checks** via `isTeacher`/`isAdmin` helpers, never strict equality.
- **No unplanned Firestore composite index**; if a door-read needs one it lives in the door app's project (`715b8`) — we do NOT `--force` deploy indexes to `715b8`. Portal-side queries reuse existing `attendanceEvents`/`levels`/`enrollments` indexes.
- **Dates** render `America/Toronto` (== door's Eastern date key).

## Slice decomposition (each gets its own plan)

- **T1 — Door-data bridge + unified resolver.** Read-only `checkInSourceFirestore()` seam (master-app Firestore now → portal Firestore later) + `masterFirestore()` helper; door readers `readDoorFamilyCheckIns(legacyFid, range)` + `readDoorGuestCheckIns(date, location?)`; a pure `resolveAttendance(portalEvents, doorCheckIns)` (portal wins → door present → unaccounted). Re-point `getCheckInAttendance` through the seam. Unit-tested with fakes; no UI. *Deliverable:* the portal can read live door check-ins read-only and merge them.
- **T2 — Redesigned teacher level-attendance screen.** New mobile-first UX: Sunday-default date, enrollment-gated roster pre-filled from the resolver (door overlay visible), present/late/absent, save → `attendanceEvents`. Reuse `deriveRoster`/`saveAttendance`. Designer pass. *Deliverable:* a teacher marks present/late/absent and sees door self-check-ins pre-filled.
- **T3 — Visitors.** Door `guest-families` children matched to the level by grade + in-class quick-add (name required; grade/email optional); confirm → pending family + `attendanceEvents` (`isGuest`). Rework the guests/add-student UX into the new screen. *Deliverable:* a teacher sees door guests in their class and can add a walk-in in seconds.
- **T4 — Family-facing union.** Child profile + dashboard BV attendance use the unified resolver (teacher marks ∪ door check-ins). N=2/programKey safety. *Deliverable:* families see consistent attendance everywhere.
- **T5 — Rollout.** Flag flip (`setuTeacher`/a dedicated flag), teacher-assignment validation, admin walkthrough, UAT walkthrough, infra check (master Firestore read perms on `715b8`). *Deliverable:* teachers use it for real.
- **Later phase (not v1) — Migration/backfill.** One-time + ongoing sync of `715b8` `family-check-ins`/`guest-families` history → portal `attendanceEvents`, so the portal becomes the sole store and the door app retires at kiosk cutover.

## Out of scope (v1 — YAGNI)

- Retiring the door app / kiosk cutover (parallel-run continues).
- The full history backfill/sync (later phase above).
- Reworking the admin role model (CMT Developer will discuss separately).
- Non-BV programs' attendance (BV is `'check-in'`/teacher-marked; others are `'none'`).
- Writing anything back to the door's `715b8` collections.

## Open prerequisites to confirm before building

1. **Master service account Firestore read on `715b8`** — the bridge needs it (today it only does RTDB). Confirm creds/permission.
2. **Email-optional visitor quick-add** — relaxing today's required-parent-email for the fastest in-class add (contact can be added later). Confirmed desired in brainstorming; lock in the plan.
