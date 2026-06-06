# Child Profile — design (umbrella spec)

**Date:** 2026-06-06
**Status:** Approved direction (CMT Developer / Vaibhav). Umbrella spec; built slice by slice (Slice 1 = profile + enrollments + attendance; Slice 2 = achievements). Each slice gets its own plan.

## Goal

A dedicated, read-focused **profile page per family member** (optimised for children) that gives families "one place" to see a student's full picture: who they are, **every program they're enrolled in**, their **attendance in each program**, and — as a fast-follow — the **achievements (badges)** teachers/admins have awarded them. The driving problem: a family with several children in *different* programs currently has no clear way to see, per child, what each one is enrolled in and how they're doing.

Inspired by the old Setu app's member-card information architecture and Vaibhav's "Google-Classroom-style, every student has a profile" framing. (The old app's profile was **hardcoded mockups** — a "Gita Chanting" block + an "OM Chanting Awards" chip strip — with no real enrollment/attendance/achievement data behind it. We borrow the *layout vocabulary* and build the real thing from the portal's existing data.)

## Locked decisions (from brainstorming)

- **Route:** a NEW dedicated read view at `/family/members/[mid]/profile`. The existing `/family/members/[mid]` stays the detail/edit-entry page and gains a prominent **"View profile"** button.
- **Attendance:** a **per-program breakdown** (each program shows its own attendance), not a single blended summary.
- **Achievements:** **teacher/admin-awarded badges** (manual), roster-checked. Not auto-derived in v1.
- **Sequencing:** **Slice 1** = the profile (enrollments + attendance), shipped first since the data already exists. **Slice 2** = achievements.
- **Audience:** **family-facing + welcome/admin** (both read-only). Families see their *own* children (own-family enforced); **welcome-team/admin can view any family's child** (it fits their front-desk family-support role; admin inherits welcome-team). Built as ONE auth-agnostic reader + ONE shared component, mounted in a family route and a welcome route, each enforcing its own access. Teachers keep their existing `/teacher/students/[mid]` view (a different concern — roster + attendance *marking* — not unified in v1).
- **Past enrollments:** included as a secondary/collapsed "Past programs" area (cheap, and matches "see all this information"). Active programs lead.

## Relationship to the planned Attendance-module migration

A **separate future initiative** will migrate the old app's Attendance module and redesign it inside this portal. To avoid rework, the child profile **must consume attendance only through narrow reader helpers** (`getChildProfile` composes per-program attendance via the existing attendance readers). When the attendance module is redesigned, **only those readers change** and the profile UI re-points without a rewrite. Do NOT hard-couple the profile to current attendance internals (e.g. don't inline `attendanceEvents` query logic into the page/component).

## Architecture (one paragraph)

The profile is assembled server-side by a single **auth-agnostic** composing reader `getChildProfile(mid)` from data that already exists: it first resolves the member's family from the `mid` (via a `collectionGroup('members')` lookup, like the existing `getStudentDetail`), then assembles member identity (via `getFamilyByFid`), the child's program enrollments (`getEnrollments(fid)` filtered by `enrolledMids.includes(mid)`), and per-program attendance (branching on each program's `capabilities.attendanceMode`). The reader does NOT check authorization — **the routes do**: the family page enforces own-family, the welcome page enforces `isWelcomeTeam`, and the API gate is *(own-family setu member) OR welcome/admin*. One shared `<ChildProfile>` presentational component renders it in both the family and welcome contexts. A mobile-ready `GET /api/setu/members/[mid]/profile` returns the same assembled JSON so a future mobile app and the web page share one contract. Slice 2 adds a small `achievements` subcollection and a teacher/admin awarding flow; the profile renders the badges read-only.

## Data model

**Slice 1 — NO new collection.** Everything is derived from existing data:
- **Member identity** — `MemberDoc` (`families/{fid}/members/{mid}`): `mid` (`CMT-XXXX-NN`), `firstName/lastName`, `type` (`'Child'|'Adult'`), `schoolGrade`, `birthMonthYear`, `foodAllergies`, `emergencyContacts`, `legacySid` (bridge to legacy BV check-ins; null for portal-native kids).
- **Enrollments** — `EnrollmentDoc` (`families/{fid}/enrollments/{eid}`, `eid = ${fid}-${oid}`): the per-child link is `enrolledMids: string[]`. Carries `programKey`, `programLabel`, `termLabel`, `location`, `status: 'active'|'cancelled'`, `oid`, `eid`. Joined to its `OfferingDoc` by `getEnrollments(fid)` → `EnrollmentWithOffering`.
- **Attendance (two sources, mode-driven)** — `attendanceEvents` (teacher-marked: `{ mid, fid, pid, levelId, date, status: 'present'|'absent'|'late' }`) read per-mid by `getAttendanceForMember(mid)`; and the legacy BV check-in (`getCheckInAttendance(legacyFid)` + `summarizeMemberCheckIns(records, legacySid)`, family-level, BV-only).
- **Programs / levels** — `ProgramDoc.capabilities.attendanceMode: 'none'|'check-in'|'teacher'` decides which source to use; `LevelDoc` (a "class") gives `levelName`/`gradeBand` (child→level is derived by `memberMatchesLevel`, not stored).

**Slice 2 — new subcollection** `families/{fid}/members/{mid}/achievements/{achId}`:
```
AchievementDoc {
  achId: string,
  mid: string,
  fid: string,
  title: string,                 // e.g. "Om Award", "Gita Level 2", "Perfect Attendance"
  description: string | null,
  programKey: string | null,     // optional tie to a program
  awardedByUid: string,
  awardedByName: string | null,  // denormalised for display
  awardedAt: Date,
}
```
Zod schema + `CreateAchievementSchema` in `@cmt/shared-domain/setu/schemas/achievement.ts`. Co-locating under the member keeps reads per-child trivial and family-scoped.

## Per-child attendance assembly (the reader logic)

For each **active** enrollment of the child, resolve the program's `attendanceMode`:
- **`'teacher'`** → from `getAttendanceForMember(mid)` (all the child's `attendanceEvents`), filter to this program's `pid`, then `summarize()` → `{ present, late, absent, total, attendedPct }` + recent marks for a heatmap.
- **`'check-in'`** (Bala Vihar) → `summarizeMemberCheckIns(getCheckInAttendance(family.legacyFid), member.legacySid)`; when `legacySid` is null → a "attendance not linked yet" note (existing copy/pattern).
- **`'none'`** → no attendance block for that program.

Reuse the heatmap + `summarize()` rendering already proven in the teacher `student-detail` view; extract the marks-heatmap into a shared presentational piece so the family profile and the teacher view stay consistent.

## Surfaces

**Slice 1:**
- **Shared `<ChildProfile>` component** (presentational, takes the serialized profile). Layout: identity header (avatar, name, `Child · Grade · MID`, allergy warning, quick stats: # programs · overall attendance %) → **Programs** (one card per active enrollment: program label · term · location · status pill, with that program's attendance % + recent-marks heatmap *inside the card*) → **Past programs** (collapsed; cancelled/ended) → **[Slice 2] Achievements** → (family context only) "Edit details" link to `[mid]/edit`. Real mobile (`block md:hidden`) + desktop (`hidden md:block`); designer pass.
- **Family page** `/family/members/[mid]/profile` (server component, own-family enforced) mounting `<ChildProfile>`.
- **Welcome page** `/welcome/family/[fid]/members/[mid]` (server component, defensive `isWelcomeTeam` re-check, any family) mounting the same `<ChildProfile>` read-only (no "Edit details").
- **Entry points** ("View profile"): the family member detail page `/family/members/[mid]`, each member in the `/family/members` list, the dashboard **My family** card, and **each member row on `/welcome/family/[fid]`**.
- **Mobile API** `GET /api/setu/members/[mid]/profile` — returns the assembled profile JSON (ISO dates); gate = *(own-family setu member) OR welcome/admin*.

**Slice 2 (achievements):**
- The profile gains a read-only **Achievements** chip strip (badge title + optional program + awarded date).
- **Awarding** on the teacher `student-detail` page: an "Award a badge" control + a list with revoke. Backed by the achievements APIs below.

## API surface

- **`GET /api/setu/members/[mid]/profile`** — gate = **(`isSetuFamily` AND the `mid` belongs to the caller's own family) OR `isWelcomeTeam`** (welcome/admin may read any family's child). For the family case the handler confirms membership by loading the family — NOT a bare string-prefix check. Returns:
  ```
  { member: {...identity}, programs: [{ programKey, label, term, location, status,
      attendance: { mode, summary?: {present,late,absent,total,attendedPct}, marks?: [{date,status}], note?: string } }],
    pastPrograms: [...], (Slice 2) achievements: [...] }
  ```
- **(Slice 2) `POST /api/setu/teacher/achievements`** `{ mid, title, description?, programKey? }` — `isTeacher` (admin inherits); enforces `canTeacherSeeStudent(session, mid)` (roster check) or admin; stamps `awardedByUid` + `awardedAt` (server timestamp).
- **(Slice 2) `DELETE /api/setu/teacher/achievements/[achId]`** — same gate (the awarder or any admin).

**canAccessRoute:** the existing `/api/setu/members/*` rule is `isSetuFamily`-only — which would block welcome-team at the middleware. So add ONE explicit rule **before** the members rule: a path ending in `/profile` under `/api/setu/members/` is allowed for **`isSetuFamily(claims) || isWelcomeTeam(claims)`** (GET; the handler then enforces own-family for the family case). `/api/setu/teacher/*` is already `isTeacher` (Slice 2 achievements). Pages: `/family/members/[mid]/profile` is under `/family/*` → `isSetuFamily`; `/welcome/family/[fid]/members/[mid]` is under `/welcome/*` → `isWelcomeTeam`. Ship the canAccessRoute change with assertion tests (welcome-team + family-member allowed on the profile API; welcome-team still denied on other `/api/setu/members/*` GETs).

## Access & security

- **Family context** (the `/family/...` page + the family branch of the API) is **own-family only**: resolve the caller's family from the session and confirm `mid` is a member of it; otherwise 404 (don't leak existence). `mid` format (`${fid}-NN`) is a hint, not the authorization — verify against the loaded family.
- **Welcome/admin context** (the `/welcome/family/[fid]/members/[mid]` page + the welcome branch of the API) may read **any** family's child, gated by `isWelcomeTeam` (admin inherits). The page re-checks `isWelcomeTeam` defensively (mirror `/welcome/family/[fid]`); the welcome page should also confirm the `mid` resolves to the `[fid]` in its own route path.
- Slice 2 awarding/revoking requires the teacher to have the student on a level they teach (`canTeacherSeeStudent`) or be an admin. All handlers mobile-ready (`readSessionFromHeaders`, never `cookies()`/`getCurrentFamily()` in the handler).

## Edge cases & rules

- **No enrollments** → friendly "not enrolled in any programs yet" + an Enroll CTA.
- **`attendanceMode: 'none'`** → no attendance block for that program.
- **Null `legacySid`** (portal-native child, BV) → "attendance isn't linked for this member yet" note.
- **Adult member** → the page still works: shows enrollments (and volunteering skills); no attendance section if none applies. Children are the focus but the route is generic per-`mid`.
- **Cross-family `mid`** → blocked in the handler/page (404).
- **N≥2 / N=3 programs** (MEMORY trap) → the programs list and per-program attendance must render ALL of a child's programs, never "the first"; tests use a child enrolled in **three** programs with distinct attendance.
- **Multiple children** → each child's profile is independent; verify with a family that has 3 kids in different programs.

## Cross-cutting: mobile-app readiness + on-theme UX (ALL slices)

- **Mobile-app readiness:** the profile API derives identity via `readSessionFromHeaders(req)` (cookie OR Bearer token), ISO-string JSON, numbers as numbers, shared `@cmt/shared-domain` types; every screen ships a real mobile (`block md:hidden`) + desktop (`hidden md:block`) layout verified at ~375px.
- **On-theme UX:** Cool-Mist tokens, `CspRoot`/`.csp` scoping (anything outside a CspRoot subtree uses inline-styled equivalents, not `.pill`/`.card` classes), designer pass for the new surfaces.
- **Role checks** via `isSetuFamily`/`isTeacher`/`isAdmin` helpers (never strict equality). **No new Firestore composite index** unless a query needs one (then add it in the same commit, UAT-only, never `--force` prod).

## Slice decomposition

- **Slice 1 — Profile (enrollments + per-program attendance).** The auth-agnostic `getChildProfile(mid)` composing reader (resolve family by mid + identity + enrollments-by-mid + mode-driven per-program attendance, reusing the attendance readers + heatmap); the shared `<ChildProfile>` component (themed, mobile + desktop, designer pass); the **family page** `/family/members/[mid]/profile` (own-family) AND the **welcome page** `/welcome/family/[fid]/members/[mid]` (isWelcomeTeam) mounting it; `GET /api/setu/members/[mid]/profile` (mobile; own-family OR welcome/admin) + the canAccessRoute `/profile` rule; "View profile" entry points from the member page, the members list, the dashboard My-family card, and the welcome family-detail member rows. *Deliverable:* a family can open any of their children — and welcome/admin can open any family's child — and see all their programs + attendance in one place.
- **Slice 2 — Achievements.** `AchievementDoc` schema + the `achievements` subcollection; the read is folded into `getChildProfile`, so badges appear wherever the profile does (family own-family AND welcome/admin); teacher/admin `POST`/`DELETE` (roster-checked) + an awarding UI on `/teacher/students/[mid]`; the profile's read-only badge section. *Deliverable:* teachers award badges and they appear on the child's profile.

## Out of scope (v1 — YAGNI)

- The full **Attendance-module migration/redesign** (separate planned initiative — the profile consumes current readers and re-points later).
- Unifying the **teacher** `/teacher/students/[mid]` view onto the shared `<ChildProfile>` component (it stays as-is in v1; converging it is a later option).
- Messaging, class notes, grades/scores, report cards; the old prototype's academic model (grade-progression chains, subjects, levels-as-assignments).
- Auto-derived achievements/milestones (could layer on later); adult-specific profile polish.
