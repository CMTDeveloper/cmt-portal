# Admin module — the control room, end to end

`/admin` is the admin-only home for running the portal. This guide maps the
whole surface, then walks the sub-modules that have no guide of their own
(**Users & roles**, **Class calendar**, **Level management**,
**Volunteering skills**, and the **Legacy** tools). The big operational
modules each have a dedicated deep-dive — this guide tells you where each
lives and links out instead of repeating them.

Three role facts that explain everything you'll see:

1. **Admin inherits welcome-team and teacher.** That's why half the admin
   tiles point into `/welcome/*` — those are shared staff surfaces, and you
   have them automatically. Welcome-team does **not** get `/admin/*` back
   (they'd see "Access denied. Admin role required.").
2. **Roles apply at the next sign-in.** Every grant, revoke, and teacher
   assignment is baked into the session cookie at sign-in — after any role
   change, the person must sign out and back in.
3. **A family role stays primary.** An admin who is also a parent signs in
   to `/family` company-wide rules apply — admin arrives as an extra
   capability, with "Back to my family" / admin links in the chrome.

Spec: `docs/superpowers/specs/2026-06-08-admin-section-revamp-design.md`.

---

## The dashboard map (`/admin`)

Four groups, fifteen tiles. Same grouping in the desktop sidebar; on mobile
the bottom tabs are Home · Programs · Levels · Calendar with everything else
under **More**.

| Group | Tile | Goes to | Deep-dive guide |
|---|---|---|---|
| People & access | Family search | `/welcome` (roster) | — (browse, filters, CSV; family detail + set-grade) |
| People & access | Users & roles | `/admin/users` | **this guide ↓** |
| Bala Vihar | Programs | `/admin/programs` | `programs-module-guide.md` |
| Bala Vihar | Level management | `/admin/levels` | **this guide ↓** + `teacher-module-guide.md` (assignment) |
| Bala Vihar | Class calendar | `/admin/calendar` | **this guide ↓** |
| Bala Vihar | School year rollover | `/admin/school-year` | `school-year-rollover-guide.md` |
| Bala Vihar | Prasad rotation | `/admin/prasad` | `prasad-module-guide.md` |
| Bala Vihar | Volunteering skills | `/admin/volunteering-skills` | **this guide ↓** |
| Bala Vihar | Seva | `/welcome/seva` | `seva-module-guide.md` |
| Reports | Reports | `/welcome/reports` | enrollment + attendance (welcome-team), donations (admin-only), legacy CSVs |
| Legacy · door app | Check-in dashboard / Guests / Unpaid families / Admin users | `/check-in/admin*` | **this guide ↓** |
| Legacy · door app | Donation periods | redirects to `/admin/programs` | kept for bookmarks |

## Users & roles (`/admin/users`)

One screen for every sevak: who has admin / welcome-team, who teaches what,
and the grant/revoke controls. The list merges all three places roles can
live (family-member role records, standalone auth-claim grants, teacher
assignments) into one row per person — search by name or contact, filter by
All / Admins / Welcome team / Teachers, and expand **"What can they
access?"** on any row for the plain-language capability list.

### Granting a role

1. Open **Add sevak role**, enter the person's **email or phone**, pick
   **Welcome team** or **Admin**, hit **Grant role →**.
2. Behind the scenes there are two paths, both automatic: a contact that
   matches a Setu family member gets the role on their **member record**
   (it then works from *both* their email and phone); anyone else gets an
   auth-claim grant keyed to that exact contact.
3. The toast says it: **"Applies at their next sign-in."** Tell them to sign
   out and back in.

⚠️ **Triple-check the spelling before granting.** There is no "contact not
found" error — an unknown contact silently **creates a brand-new user** with
the role attached (and anything without `@` is treated as a phone number). A
typo'd grant = a ghost admin nobody can sign in as. To clean one up, revoke
against the exact same wrong string.

Two more grant facts worth knowing: re-granting an existing role is
harmless (idempotent), and a not-yet-migrated legacy family's contact takes
the auth-claim path — the role then rides on *that one contact only* until
the family migrates into Setu.

**Teacher is not grantable here** — teacher status shows read-only with the
levels they teach ("Manage as teacher →" jumps to `/admin/levels`).
Assigning levels *is* how someone becomes a teacher; see
`teacher-module-guide.md`.

### Revoking a role

**Revoke** on the row → confirm. Two guards protect the org, both only on
the **admin** role: you cannot revoke **your own** admin, and you cannot
revoke the **last** admin ("grant another admin first"). Revoking
welcome-team has no guards. Remember: a revoked admin keeps access until
their current session ends (≤ 14 days) or they sign out.

**CLI parity:** `pnpm --filter @cmt/portal grant:admin grant|revoke|list
<email-or-phone>` (and `grant:welcome-team`) do exactly the same writes —
UAT-guarded, `--allow-prod` to override.

## Class calendar (`/admin/calendar`)

The published Sunday schedule families see — and the backbone for
attendance percentages and prasad eligibility.

### Adding the season

1. Pick the **location** (and program, if more than one program uses a
   calendar — defaults to Bala Vihar).
2. **Add a calendar entry**: Date · Kind (**Class** / **No class**) · then
   either Class type (**Regular / First class / Short class**) or a
   no-class reason ("Winter Break") · optional Special events ("Ganesh
   Puja"). One entry per date — a duplicate date is rejected.
3. New entries are born **Published** and **Prasad-eligible**. If you're
   drafting next year early, toggle each to **Draft** right away or
   families see it on their dashboard immediately.
4. The **weekly schedule** panel (time + label rows, e.g. "10:00 – 10:45 am
   · Assembly") is display-only text shown to families and teachers — save
   replaces the whole list.

There is no bulk "generate all Sundays" button — a season is keyed in by
hand (~40 entries) or seeded by a developer via
`pnpm --filter @cmt/portal seed:bala-vihar-calendar` (the script contains
the hardcoded Brampton 2025-26 season and must be edited for a new year or
location). **The school-year rollover does NOT create the new calendar** —
it's a manual step right after Step 1 of the rollover.

### Fixing a wrong entry

Each row has exactly three controls: the **Published/Draft** pill, the
**Prasad / No prasad** pill (class rows only), and **× delete**. The date,
kind, class type, reason, and special-events text **cannot be edited after
creation** — fix a mistake by deleting the row and re-adding it. ⚠️ The ×
deletes **immediately, with no confirmation** — aim carefully.

### Why the calendar matters downstream

- **Family dashboard**: the next 3 published entries become the "Upcoming"
  card, and published class days held so far are the denominator of every
  family's "X of Y Sunday classes". Draft entries count for nothing.
- **Prasad**: only published, prasad-eligible class Sundays can be assigned
  (toggle **No prasad** for Diwali events, holiday assemblies…).
- A welcome-team member *can* write calendar entries via the API, but the
  editor page itself is admin-only — in practice this is an admin task.

## Level management (`/admin/levels`)

Levels are the Bala Vihar classes (per location, per school year): name,
kind (Shishu / pre-level / level / parents), display order, **grade band**
(which school grades belong — two-grade bands are how Level 2 holds Grades
2–3), age label, curriculum line, and the assigned teachers.

- **+ New level**: pick the period (location · year — locked after
  creation), name it, set the grade band and order, save. **Edit** adjusts
  everything except the period.
- Grade bands drive both the rollover's level re-derivation and the
  teacher-roster membership — edit them with care mid-year (rosters change
  immediately).
- The **Teachers** column shows the per-level assignment count — scan for
  `0` to find uncovered classes. Assignment itself (the "Assign teacher"
  form, replace semantics, next-sign-in effect) is covered step-by-step in
  `teacher-module-guide.md`.

## Volunteering skills (`/admin/volunteering-skills`)

The admin-curated list of skills families can pick on the member form
(max 50, each up to 60 characters; duplicates auto-removed). Changes apply
the next time a family opens the form. Removing a skill from the list does
**not** strip it from members who already selected it.

## The welcome surfaces you also own

Admin inherits welcome-team, so these are part of the admin job too:
**`/welcome/roster`** (browse/search/filter every family, payment chips,
CSV export, drill into family detail — where the rollover's set-grade
editor lives), **`/welcome/reports`** (enrollment + attendance for all
staff; **donations card is admin-only**), **`/welcome/seva`** (post
opportunities, confirm hours, compliance report — the seva-year requirement
panel is admin-only), and **`/welcome/prasad`** (day-of list).

## Legacy · door app (retiring at kiosk cutover)

These screens serve the standalone Sunday check-in kiosk and are gated by
the check-in feature flags. They dim with a "Legacy" badge:

- **Check-in dashboard** — today/this-week check-in stats, guest counts.
- **Guests** — the kiosk's guest check-in log (read-only).
- **Unpaid families** — legacy roster payment column, with the manual
  "Send donation email" button.
- **Admin users** — ⚠️ grants the **legacy kiosk's** admin claim only. This
  is NOT the same as `/admin/users` — all portal roles are managed on the
  themed Users & roles screen. When in doubt, use `/admin/users`.

## Quick reference

| Task | Where |
|---|---|
| Make someone admin / welcome-team | `/admin/users` → Add sevak role (next sign-in!) |
| Make someone a teacher | `/admin/levels` → Assign teacher (`teacher-module-guide.md`) |
| New program / offering / pricing | `/admin/programs` (`programs-module-guide.md`) |
| Create/edit a level, grade bands | `/admin/levels` (this guide) |
| Publish class Sundays + prasad toggles | `/admin/calendar` (this guide) |
| Promote everyone to the new school year | `/admin/school-year` (`school-year-rollover-guide.md`) |
| Propose/assign prasad Sundays | `/admin/prasad` (`prasad-module-guide.md`) |
| Member-form skills list | `/admin/volunteering-skills` |
| Find a family / export CSV / fix a grade | `/welcome` roster |
| Reports (enrollment / attendance / donations) | `/welcome/reports` |
| Seva year, opportunities, compliance | `/welcome/seva` (`seva-module-guide.md`) |

## Notes for developers

- Access: `/admin/*` pages and `/api/admin/*` are `isAdmin`-only via
  `canAccessRoute`, with exactly two welcome-team carve-outs (checked
  before the catch-all): `POST /api/admin/teacher-assignments` and the
  `/api/admin/calendar*` routes (RBB-2 front-desk flexibility). The admin
  layout re-verifies the session cookie defensively.
- Role storage is three-way: `roleAssignments/{mid}` (family members,
  contact-agnostic), Firebase Auth custom claims on
  `sha256(normalizedContact)` (standalone sevaks), `teacherAssignments/
  {ref}` (teacher capability, computed at session build). `listSevaks()`
  merges + dedupes (mid → tid → uid) and scans the full Auth user list —
  its cost grows with the OTP user base.
- Grant/revoke errors: 401 `no-session`, 403 `forbidden`, 400
  `bad-request`, 409 `self-lockout` / `last-admin` (admin-revoke only).
  Grants are idempotent; unknown contacts create the Auth user (the ghost
  gotcha above).
- Calendar: `classCalendarEntries`, deterministic id
  `{programKey}-{location}-{date}` — which is why date/location/program are
  immutable (delete + re-add). The POST handler doesn't write
  `prasadNeeded`; readers default missing → `true`. `kind`↔`classType`
  consistency is enforced on PATCH. `weeklySchedules/{location}` is a
  single display-only doc.
- Redirect shims: `/admin/donation-periods` → `/admin/programs`,
  `/admin/welcome-team` → `/admin/users`, `/admin/welcome` → `/welcome`,
  `/check-in/admin/reports` → `/welcome/reports`.
- Legacy `/check-in/admin/*` needs `NEXT_PUBLIC_FEATURE_CHECK_IN` +
  `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN`; the themed `/admin/*` surfaces have
  no feature flags (role-gated only).
- E2E: `e2e/setu/admin/*.spec.ts` covers roster/reports; the users & roles
  grant/revoke flow has route tests but no browser E2E (gap).
