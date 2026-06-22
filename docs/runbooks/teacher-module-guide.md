# Teacher module — how it works, end to end

**What this is:** the guide to Sunday attendance in the portal — for Bala
Vihar teachers, and for the admins who set them up.

Here is the whole flow in one breath. An admin assigns a teacher to one or
more **levels** (classes). Each Sunday the teacher opens their class, marks
every child **Present / Late / Absent**, and saves. The marks flow straight
to the family dashboards and the welcome-team reports — nothing else to
publish.

One idea makes everything else make sense: **"teacher" is not a role you
grant — it comes automatically from being assigned to a class.** There is no
teacher checkbox on the user list (/admin/users); teacher status shows there
for information only. The moment someone is assigned to at least one level in
**Level management** (/admin/levels) and signs in again, they are a teacher.

---

## Part 1 — Admin: onboarding a teacher

### First: the teacher must be a registered family member

The portal identifies teachers from the **email they use to sign in** and
resolves that email to the person's registered family member record. So a
prospective teacher must already be part of an active registered family. If
they aren't, register them like any family first. A "standalone teacher" with
no family **cannot sign in today** — every real teacher is a parent or adult
in a registered family.

### Assign their classes — this is the whole onboarding

1. Open **Level management** (/admin/levels) and find the **Assign teacher**
   form.
2. Type the teacher's sign-in email.
3. Tick **every** level they teach. ⚠️ Careful here: ticking sets the
   teacher's **full** list of classes — it *replaces* their old list, it does
   not add to it. To give an existing teacher one more class, you must
   re-tick all the classes they should keep; ticking only the new one quietly
   removes them from the rest. The form does not pre-fill their current
   classes — to see what they have today, open the user list (/admin/users)
   and filter by "Teacher".
4. Click **Save**. The toast says it plainly: **"Takes effect on their next
   sign-in."** Tell the teacher to sign out and sign back in — there is no
   shortcut to refresh it.

A "universal teacher" (someone who sees every class, at both locations) is
simply a teacher assigned to **all** enabled levels — there is no special
switch for it.

The Levels table shows a **Teachers count** for each level, so a quick scan
finds classes showing `0` that still need someone. (The welcome team gets a
read-only view of levels and class rosters at /welcome/levels; the assigning
itself happens on the admin screen.)

### Don't skip: publish the class calendar

On the class calendar (/admin/calendar), publish the year's class Sundays.
Those published Sundays are what the portal counts against for every family's
"X of Y Sunday classes" — without them, the percentages quietly read
misleadingly high. Teachers can mark attendance without the calendar, but the
family-facing numbers need it. Recommended order each year:
**create/clone levels → publish calendar → assign teachers**.

## Part 2 — Teacher: the Sunday routine

1. **Sign in** at /sign-in — the normal family sign-in, nothing special. You
   land on your family page (/family), because your family role stays your
   main one. Your teacher tools are behind the **Teacher** link in the
   sidebar's Sevak section (desktop and mobile).
2. **My classes** (/teacher) lists every enabled level assigned to you. (A
   new teacher with no classes yet sees: "You haven't been assigned to any
   classes yet. Ask the admin or welcome team to add you.")
3. **Tap a class** to open the attendance screen. It opens on the **most
   recent Sunday** (Toronto time). The ‹ › arrows step one week back or
   forward. Future dates show "This class is upcoming" and can't be marked.
   Past Sundays stay fully editable — marking again simply overwrites what
   was there (there is no history kept).
4. **Mark each child** Present, Late, or Absent. Tap the active status again
   to un-mark. Children who checked in at the door kiosk arrive already
   marked **Present** with a "door" pill — you can still change it, and your
   mark always wins. A red dot flags a child with **food allergies**.
5. **Tap Save** in the fixed bar at the bottom. Only marked children are
   recorded; unmarked rows stay "unaccounted". The stats band tracks
   Enrolled · Checked-in · Present · Late · Absent · Unmarked with a progress
   bar.
6. **Want more on a child?** Tap any name to open their detail page
   (/teacher/students/{mid}): grade, an always-visible allergy and
   emergency-contact banner, their attendance summary with a heatmap, parent
   contact info, and achievements.

### Visitors and walk-ins (the **Visitors →** link on the attendance screen)

- **Door guests** whose grade fits your class appear under "Checked in at the
  door" — one tap on **Confirm** marks them present.
- **Quick-add** takes in a walk-in child on the spot: first name (required),
  last name, grade, parent email/phone. ⚠️ **This creates a real (pending)
  family record and enrolls the child for the period** — the parent claims it
  the first time they sign in with that email or phone. Always capture a
  parent email or phone; without one, the record can never be claimed. You
  are creating a membership, not just a tally mark.

Two practical notes:

- A child unenrolled mid-year drops off your roster automatically. If you had
  a stray mark for them, it is skipped, not saved.
- When two teachers share a class, they see and edit the same roster — for
  any one child and date, the last save wins.

## Part 3 — Where the marks go (families)

- **Family dashboard** (/family): the Bala Vihar card shows "X of Y Sunday
  classes" the moment you save — there is no publish step. The family's
  number combines all their children: if any one child was present that
  Sunday, the family counts as present. The "Y" comes from the published
  class calendar.
- **Each child's own record** lives on their member page
  (/family/members/{mid}): that child's present/late/absent history for the
  Bala Vihar year.
- **Welcome team and admins** see the same per-child summary, plus the
  heatmap, at /welcome/family/{fid}/members/{mid}.

## Part 4 — Reports

On the reports page (/welcome/reports), the **attendance summary** card adds
up present, absent, and late marks, plus an attendance rate, for each level
and each program. It has a date-range control and a CSV export. With no dates
selected it covers the **last 365 days** — not all-time. Welcome team and
admins can run it (the donations card stays admin-only).

## Year-end: the rollover re-assignment ritual

⚠️ **The school-year rollover clones every level with an empty teacher
list** — on purpose. After running the rollover, re-assign **every** teacher
to the new year's levels in **Level management** (/admin/levels). Their stale
prior-year assignment keeps the Teacher link visible, but their "My classes"
page goes empty once the old levels are turned off. Because saving replaces
the whole list, re-ticking just the new year's levels clears out the old ones
in the same stroke. See Step 5 of the
[school-year rollover guide](school-year-rollover-guide.md).

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | **Level management** (/admin/levels) | Create/edit levels · **Assign teacher** (email + tick classes — ticking replaces the whole list) |
| Admin | Class calendar (/admin/calendar) | Publish class Sundays (the "Y" in families' "X of Y") |
| Admin | User list (/admin/users), filter "Teacher" | See who teaches what — read-only |
| Teacher | Sidebar **Teacher** link → /teacher | My classes list |
| Teacher | A class → its attendance screen (/teacher/levels/{levelId}/attendance) | Mark Present/Late/Absent per Sunday, then **Save** |
| Teacher | **Visitors →** | Confirm door guests · quick-add walk-ins (creates a pending family) |
| Teacher | /teacher/students/{mid} | Child detail: allergies, contacts, heatmap |
| Family | /family and /family/members/{mid} | "X of Y Sundays" card · each child's history |
| Welcome team | /welcome/levels, /welcome/reports | Read-only rosters · attendance summary + CSV |

**Statuses:** a child is Present, Late, or Absent. A child nobody marked
shows as "unaccounted" — that just means no mark yet; it is not a saved
status. Guests are counted separately and sit outside the class-roster tally.

## Notes for developers

- Spec: `docs/superpowers/specs/2026-05-29-slice-4-teacher-attendance-design.md`.
- Stored status values: `present` / `late` / `absent`; "unaccounted" =
  unmarked (derived, never stored). Guests carry `isGuest: true` and sit
  outside the roster tally.
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
