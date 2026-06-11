# Teacher module — how it works, end to end

Bala Vihar teachers take Sunday attendance in the portal. An admin assigns a
teacher to one or more **levels** (classes); the teacher opens their class
each Sunday, marks every child **Present / Late / Absent**, and the results
flow straight to the family dashboards and the welcome-team reports.

The one idea that makes everything else make sense: **"teacher" is not a role
you grant — it's a capability that follows from being assigned to a level.**
There is no teacher checkbox on `/admin/users` (teacher status shows there
read-only). The moment a person is assigned to at least one level at
`/admin/levels` and signs in again, they are a teacher.

Spec: `docs/superpowers/specs/2026-05-29-slice-4-teacher-attendance-design.md`.

---

## Part 1 — Admin: onboarding a teacher

### Prerequisite: the teacher must be a registered family member

Teachers are identified by their **member id (mid)** — so a prospective
teacher must already exist in a Setu family (register them like any family if
they aren't). A "standalone teacher" with no family **cannot sign in today**;
every real teacher is a parent/adult in a registered family.

**Finding the mid:** open `/welcome/roster`, search the person's family,
click through to their member profile — the mid (format `CMT-XXXX1111-01`) is
the last segment of the page URL `/welcome/family/{fid}/members/{mid}`.

### Assign levels (`/admin/levels` — the whole onboarding)

1. Open `/admin/levels` → **"Assign teacher"** form.
2. Enter the teacher's mid in the ref box.
3. Tick every level they teach. **Ticking sets the teacher's FULL level set**
   — this is a *replace*, not an add. To add one level to an existing teacher
   you must re-tick all the levels they should keep; ticking only the new one
   silently unassigns the rest. (The form does not pre-load their current
   set — check their row at `/admin/users`, filter "Teacher", to see it.)
4. Save. The toast says it plainly: **"Takes effect on their next sign-in."**
   Tell the teacher to sign out and back in — there is no refresh shortcut.

A "universal teacher" (sees every class, both locations) is simply a teacher
assigned to **all** enabled levels — there is no special toggle.

The Levels table shows a per-level **Teachers count**, so a quick scan finds
classes with `0` that still need someone. (Welcome-team gets a read-only view
of levels and rosters at `/welcome/levels`; assignment itself is an
admin-screen task.)

### Don't skip: publish the class calendar (`/admin/calendar`)

The calendar's published `class` Sundays are the **denominator** for every
family's "X of Y Sunday classes" — without it, percentages silently read
misleadingly high. Marking attendance itself does *not* require the calendar,
but the family-facing math does. Recommended order each year:
**create/clone levels → publish calendar → assign teachers**.

## Part 2 — Teacher: the Sunday routine

1. **Sign in** at `/sign-in` (normal family sign-in). Teachers land on
   `/family` — their family role stays primary. The teacher surface is the
   **"Teacher"** link in the sidebar's Sevak section (desktop and mobile).
2. **`/teacher` — My classes** lists every enabled level assigned to you.
   (New teacher with no classes yet sees: "You haven't been assigned to any
   classes yet. Ask the admin or welcome team to add you.")
3. **Tap a class** → the attendance screen, opened on the **most recent
   Sunday** (Toronto time). The ‹ › arrows step one week back/forward; future
   dates show "This class is upcoming" and can't be marked. Past Sundays stay
   fully editable — re-marking simply overwrites (no history).
4. **Mark each child** Present / Late / Absent — tap the active status again
   to un-mark. Children who checked in at the door kiosk arrive pre-seeded
   **Present** with a "door" pill (you can still override — your mark always
   wins). A red dot flags a child with **food allergies**.
5. **Save** (the fixed bottom bar). Only marked children are recorded;
   unmarked rows stay "unaccounted". The stats band tracks Enrolled ·
   Checked-in · Present · Late · Absent · Unmarked with a progress bar.
6. **Child detail:** tap any name → `/teacher/students/{mid}` — grade, an
   always-visible allergy + emergency-contact banner, their attendance
   summary with a heatmap, parent contact info, and achievements.

### Visitors and walk-ins (`Visitors →` on the attendance screen)

- **Door guests** that match your class's grade band appear under "Checked in
  at the door" — one **Confirm** marks them present.
- **Quick-add** takes a walk-in child on the spot: first name (required),
  last name, grade, parent email/phone. ⚠️ **This creates a real (pending)
  family record and auto-enrolls it for the period** — the parent claims it
  when they first sign in with that contact. Always capture a parent email or
  phone; without one the record can't be claimed. You're creating membership,
  not just a tally mark.

Two practical notes: a child unenrolled mid-year drops off your roster
automatically (any stray mark for them is skipped, not saved), and when two
teachers share a level they see and edit the same roster — the last save for
a given child + date wins.

## Part 3 — Where the marks go (families)

- **Family dashboard** (`/family`): the Bala Vihar card shows "X of Y Sunday
  classes" the moment you save — no publish step. The family number is a
  *union across their children* (one present child makes the family present
  that Sunday), and Y comes from the published class calendar.
- **Per-child truth** lives on the member page (`/family/members/{mid}`):
  each child's own present/late/absent record for the BV year.
- **Welcome team / admin** see the same per-child summary plus the heatmap at
  `/welcome/family/{fid}/members/{mid}`.

## Part 4 — Reports (`/welcome/reports`)

The **attendance summary** card aggregates present/absent/late and an
attendance rate per level and per program, with a date-range control and CSV
export. No dates selected = the **last 365 days**, not all-time.
Welcome-team and admin can run it (donations stays admin-only).

## Year-end: the rollover re-assignment ritual

⚠️ **The school-year rollover clones every level with an empty teacher
list** — deliberately. After running the rollover, re-assign **every**
teacher to the new year's levels at `/admin/levels` (their stale prior-year
assignment keeps the Teacher link alive, but "My classes" goes empty once the
old levels are disabled). Because saving replaces the whole set, re-ticking
just the new year's levels cleans out the old ids in the same stroke. See
[`school-year-rollover-guide.md`](school-year-rollover-guide.md) Step 5.

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | `/admin/levels` | Create/edit levels · **Assign teacher** (mid + tick levels — replace semantics) |
| Admin | `/admin/calendar` | Publish class Sundays (family-% denominator) |
| Admin | `/admin/users` (filter Teacher) | See who teaches what — read-only |
| Teacher | sidebar **Teacher** link → `/teacher` | My classes list |
| Teacher | `/teacher/levels/{levelId}/attendance` | Mark Present/Late/Absent per Sunday, Save |
| Teacher | `Visitors →` | Confirm door guests · quick-add walk-ins (creates pending family) |
| Teacher | `/teacher/students/{mid}` | Child detail: allergies, contacts, heatmap |
| Family | `/family` + `/family/members/{mid}` | "X of Y Sundays" card · per-child history |
| Welcome team | `/welcome/levels`, `/welcome/reports` | Read-only rosters · attendance summary + CSV |

**Statuses:** `present` / `late` / `absent` (stored) · "unaccounted" =
unmarked (derived, never stored) · guests carry `isGuest: true` and sit
outside the roster tally.

## Notes for developers

- Collections: `levels/{levelId}` (id `{location}-{levelSlug}-{pid}`, holds
  the denormalized `teacherRefs: string[]`), `teacherAssignments/{ref}`
  (`levelIds`, the source of truth — `assignTeacher()` updates both in one
  atomic batch), `attendanceEvents/{levelId}-{mid}-{date}` (composite aid =
  idempotent overwrite), `classCalendarEntries`.
- Indexes (all in `firestore.indexes.json`): `levels(teacherRefs CONTAINS,
  enabled)` + `attendanceEvents` `(levelId,date)` / `(mid,date DESC)` /
  `(fid,date DESC)`. Deploy to prod at cutover, never `--force`.
- Access: `isTeacher()` = `teacher` in role/extraRoles OR admin (welcome-team
  does **not** inherit). Teacher is an `extraRoles` capability computed at
  session build from `isTeacherAssigned(mid)` — never the primary role, so
  `dashboardForRole` sends teachers to `/family`. `POST
  /api/admin/teacher-assignments` allows admin **or** welcome-team (RBB-2),
  but the only assignment UI is on the admin-only `/admin/levels` page.
- Flag: `NEXT_PUBLIC_FEATURE_SETU_TEACHER` gates `/teacher/*` (redirect to
  `/family`) and `/api/setu/teacher/*` (404) in middleware. **ON in Vercel
  production env as of 2026-06; OFF in `.env.example`/local dev and unset in
  Preview.** It is NOT in `turbo.json`'s env array — fine while every read is
  server-side, but any future client-component read of `flags.setuTeacher`
  must add it there first or it inlines as `false` in Vercel builds.
- The future-date guard is **UI-only** — `POST /api/setu/teacher/attendance`
  validates YMD format + roster membership but accepts any date (a
  hand-edited `?date=` can be a Wednesday; the class calendar is not checked
  when marking).
- Admin can mark any level by URL (`canTeachLevel` short-circuits on
  `isAdmin`), but `/teacher` lists only levels containing the admin's own
  mid — an unassigned admin sees the empty state and navigates by level id.
- Door pre-seeding joins the standalone kiosk's data via
  `member.legacyFid/legacySid` — Setu-native families (new registrations,
  visitor pending-families) never show door data; teachers mark them
  manually. Portal marks always override door check-ins.
- Dead/latent paths: the standalone-teacher `tid` (`teachers` collection)
  exists in schema and the `/admin/users` display only — nothing writes it
  and no-family contacts can't get a session; `/api/setu/teacher/add-student`
  exists with zero UI references (the Visitors quick-add is the live
  surface).
- E2E: `e2e/setu/test-accounts.spec.ts` covers the three teacher personas
  (Brampton Level 1 only, Scarborough Level A only, universal ≥18 levels).
  UAT accounts: `setu-test-teacher-{brampton,scarborough,universal}@chinmayatoronto.org`
  (see [`test-accounts.md`](test-accounts.md)). Gap: no E2E for the attendance-save round-trip or
  the visitors flow.
