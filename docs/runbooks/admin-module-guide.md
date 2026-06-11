# Admin module — the control room, end to end

**What this is:** your map of the admin side of the portal. The **Admin**
home page (`/admin`) is where admins run everything. This guide walks the
whole surface, then covers the sub-modules that have no guide of their own
(**Users & roles**, **Class calendar**, **Level management**,
**Volunteering skills**, and the **Legacy** tools). The big operational
modules each have their own deep-dive guide — for those, this guide just
tells you where they live and links out instead of repeating them.

Three facts about roles that explain everything you'll see:

1. **Admins automatically get welcome-team and teacher access too.** That's
   why half the admin tiles point to `/welcome/*` pages — those are shared
   staff pages, and you have them automatically. It does not work the other
   way around: welcome-team members do **not** get the `/admin/*` pages
   (they'd see "Access denied. Admin role required.").
2. **Role changes take effect when the person next signs in.** Every grant,
   revoke, and teacher assignment kicks in at sign-in — so after any role
   change, the person must sign out and back in.
3. **A family role stays first.** An admin who is also a parent still signs
   in to their family home (`/family`) like any other parent — the admin
   powers come along as an extra, with "Back to my family" and admin links
   in the page header.

---

## The dashboard map (`/admin`)

Four groups, fifteen tiles. The desktop sidebar uses the same grouping; on
mobile the bottom tabs are Home · Programs · Levels · Calendar, with
everything else under **More**.

| Group | Tile | Goes to | Deep-dive guide |
|---|---|---|---|
| People & access | Family search | `/welcome` (roster) | — (browse, filters, spreadsheet export; family detail + set-grade) |
| People & access | Users & roles | `/admin/users` | **this guide ↓** |
| Bala Vihar | Programs | `/admin/programs` | [programs guide](programs-module-guide.md) |
| Bala Vihar | Level management | `/admin/levels` | **this guide ↓** + [teacher guide](teacher-module-guide.md) (assigning teachers) |
| Bala Vihar | Class calendar | `/admin/calendar` | **this guide ↓** |
| Bala Vihar | School year rollover | `/admin/school-year` | [rollover guide](school-year-rollover-guide.md) |
| Bala Vihar | Prasad rotation | `/admin/prasad` | [prasad guide](prasad-module-guide.md) |
| Bala Vihar | Volunteering skills | `/admin/volunteering-skills` | **this guide ↓** |
| Bala Vihar | Seva | `/welcome/seva` | [seva guide](seva-module-guide.md) |
| Reports | Reports | `/welcome/reports` | enrollment + attendance (all staff), donations (admin-only), legacy downloads |
| Legacy · door app | Check-in dashboard / Guests / Unpaid families / Admin users | `/check-in/admin*` | **this guide ↓** |
| Legacy · door app | Donation periods | sends you to `/admin/programs` | kept so old bookmarks still work |

## Users & roles (`/admin/users`)

One screen for every sevak: who has admin or welcome-team access, who
teaches what, and the controls to grant or take away roles. The list merges
the three places a role can live behind the scenes (a role on a family
member's record, a role granted directly to an email or phone, and teacher
assignments) into one row per person. You can search by name or contact,
filter by All / Admins / Welcome team / Teachers, and expand **"What can
they access?"** on any row to see a plain-language list of what that person
can do.

### Granting a role

1. Open **Add sevak role**.
2. Type the person's **email or phone**.
3. Pick **Welcome team** or **Admin**, then click **Grant role →**.
4. Behind the scenes there are two paths, and both are automatic: if the
   contact matches a member of a family already in the portal, the role
   goes on their **member record** — it then works whether they sign in
   with their email *or* their phone. Anyone else gets the role attached to
   that exact email or phone only.
5. The toast tells you the key thing: **"Applies at their next sign-in."**
   Tell the person to sign out and back in.

⚠️ **Triple-check the spelling before granting.** There is no "contact not
found" error — an unknown contact silently **creates a brand-new user**
with the role attached (and anything without an `@` sign is treated as a
phone number). A typo'd grant = a ghost admin nobody can sign in as. To
clean one up, revoke against the exact same wrong spelling.

Two more grant facts worth knowing:

- Granting a role someone already has is harmless — it's safe to do again.
- If someone's family hasn't yet moved into the new portal, a grant to
  their contact works for *that one email or phone only* until the family
  is migrated in.

**You cannot make someone a teacher here.** Teacher status shows read-only,
with the levels they teach ("Manage as teacher →" jumps to
`/admin/levels`). Someone becomes a teacher by being assigned to a level —
see the [teacher guide](teacher-module-guide.md).

### Revoking a role

Click **Revoke** on the person's row, then confirm. Two guards protect the
organization, and both apply only to the **admin** role:

- You cannot revoke **your own** admin role.
- You cannot revoke the **last** admin ("grant another admin first").

Revoking welcome-team has no guards. Remember: a revoked admin keeps access
until their current session ends (up to 14 days) or they sign out.

The tech team can also grant, revoke, and list roles from the command line —
it does exactly the same thing as this screen (details in Notes for
developers).

## Class calendar (`/admin/calendar`)

This is the published Sunday schedule families see — and the backbone for
attendance percentages and prasad eligibility.

### Adding the season

1. Pick the **location** (and the program, if more than one program uses a
   calendar — it defaults to Bala Vihar).
2. Click **Add a calendar entry** and fill it in: the Date · the Kind
   (**Class** / **No class**) · then either the Class type (**Regular /
   First class / Short class**) or a no-class reason (like "Winter Break") ·
   plus optional Special events (like "Ganesh Puja"). Only one entry per
   date — a duplicate date is rejected.
3. New entries start out **Published** and **Prasad-eligible**. If you're
   drafting next year early, switch each one to **Draft** right away —
   otherwise families see it on their dashboard immediately.
4. The **weekly schedule** panel (rows of time + label, e.g. "10:00 –
   10:45 am · Assembly") is display-only text shown to families and
   teachers. Saving replaces the whole list.

There is no bulk "generate all Sundays" button — you key in a season by
hand (about 40 entries), or ask the tech team to load it with their seeding
script. (Their script currently contains the Brampton 2025-26 season
built in, and they must edit it for a new year or location.) **The
school-year rollover does NOT create the new calendar** — it's a manual
step you do right after Step 1 of the rollover.

### Fixing a wrong entry

Each row has exactly three controls: the **Published/Draft** pill, the
**Prasad / No prasad** pill (class rows only), and **× delete**. The date,
kind, class type, reason, and special-events text **cannot be edited after
creation** — to fix a mistake, delete the row and add it again. ⚠️ The ×
deletes **immediately, with no confirmation** — aim carefully.

### Why the calendar matters downstream

- **Family dashboard**: the next 3 published entries become the "Upcoming"
  card, and the published class days held so far are the "Y" in every
  family's "X of Y Sunday classes" count. Draft entries count for nothing.
- **Prasad**: only published, prasad-eligible class Sundays can be
  assigned. Switch a day to **No prasad** for Diwali events, holiday
  assemblies, and the like.
- A welcome-team member technically has behind-the-scenes permission to add
  calendar entries, but the editor page itself is admin-only — in practice
  this is an admin task.

## Level management (`/admin/levels`)

Levels are the Bala Vihar classes (one set per location, per school year).
Each level has: a name, a kind (Shishu / pre-level / level / parents), a
display order, a **grade band** (which school grades belong — two-grade
bands are how Level 2 holds Grades 2–3), an age label, a curriculum line,
and the assigned teachers.

- **+ New level**: pick the period (location · year — locked after
  creation), name it, set the grade band and order, save. **Edit** lets you
  adjust everything except the period.
- Grade bands matter twice over: they decide which level each child lands
  in at the school-year rollover, and which children appear on a teacher's
  class list. Edit them with care mid-year — class lists change
  immediately.
- The **Teachers** column shows how many teachers each level has — scan for
  `0` to find uncovered classes. Assigning a teacher (the **Assign
  teacher** form, what happens when you replace someone, and the
  sign-out-and-back-in step) is covered step-by-step in the
  [teacher guide](teacher-module-guide.md).

## Volunteering skills (`/admin/volunteering-skills`)

The admin-curated list of skills families can pick on the member form
(max 50 skills, each up to 60 characters; duplicates are removed
automatically). Changes apply the next time a family opens the form.
Removing a skill from the list does **not** remove it from members who
already selected it.

## The welcome pages you also own

Because admins automatically get welcome-team access, these pages are part
of the admin job too:

- **Roster** (`/welcome/roster`) — browse, search, and filter every family;
  payment chips; spreadsheet (CSV) export; drill into a family's detail
  page — which is also where the rollover's set-grade editor lives.
- **Reports** (`/welcome/reports`) — enrollment and attendance for all
  staff; the **donations card is admin-only**.
- **Seva** (`/welcome/seva`) — post opportunities, confirm hours, run the
  compliance report. The seva-year requirement panel is admin-only.
- **Prasad** (`/welcome/prasad`) — the day-of list.

## Legacy · door app (retiring at kiosk cutover)

These screens serve the standalone Sunday check-in kiosk. They only appear
when the tech team has the legacy check-in switches turned on, and they
show dimmed with a "Legacy" badge:

- **Check-in dashboard** — today / this-week check-in stats and guest
  counts.
- **Guests** — the kiosk's guest check-in log (read-only).
- **Unpaid families** — the legacy roster's payment column, with the manual
  **Send donation email** button.
- **Admin users** — ⚠️ this grants admin on the **legacy kiosk only**. It
  is NOT the same as Users & roles (`/admin/users`) — all portal roles are
  managed on the themed Users & roles screen. When in doubt, use
  `/admin/users`.

## Quick reference

| Task | Where |
|---|---|
| Make someone admin / welcome-team | **Users & roles** (`/admin/users`) → Add sevak role (takes effect at next sign-in!) |
| Make someone a teacher | **Level management** (`/admin/levels`) → Assign teacher ([teacher guide](teacher-module-guide.md)) |
| New program / offering / pricing | **Programs** (`/admin/programs`) ([programs guide](programs-module-guide.md)) |
| Create or edit a level, grade bands | **Level management** (`/admin/levels`) (this guide) |
| Publish class Sundays + prasad switches | **Class calendar** (`/admin/calendar`) (this guide) |
| Promote everyone to the new school year | **School year rollover** (`/admin/school-year`) ([rollover guide](school-year-rollover-guide.md)) |
| Propose / assign prasad Sundays | **Prasad rotation** (`/admin/prasad`) ([prasad guide](prasad-module-guide.md)) |
| Edit the member-form skills list | **Volunteering skills** (`/admin/volunteering-skills`) |
| Find a family / export the spreadsheet / fix a grade | **Roster** (`/welcome`) |
| Reports (enrollment / attendance / donations) | **Reports** (`/welcome/reports`) |
| Seva year, opportunities, compliance | **Seva** (`/welcome/seva`) ([seva guide](seva-module-guide.md)) |

## Notes for developers

- Spec: `docs/superpowers/specs/2026-06-08-admin-section-revamp-design.md`.
- Access: `/admin/*` pages and `/api/admin/*` are `isAdmin`-only via
  `canAccessRoute`, with exactly two welcome-team carve-outs (checked
  before the catch-all): `POST /api/admin/teacher-assignments` and the
  `/api/admin/calendar*` routes (RBB-2 front-desk flexibility). The admin
  layout re-verifies the session cookie defensively.
- Role changes are baked into the session cookie at sign-in — that's the
  "applies at next sign-in" rule; revoked access persists until cookie
  expiry (≤ 14 days) or sign-out.
- Role storage is three-way: `roleAssignments/{mid}` (family members,
  contact-agnostic), Firebase Auth custom claims on
  `sha256(normalizedContact)` (standalone sevaks), `teacherAssignments/
  {ref}` (teacher capability, computed at session build). `listSevaks()`
  merges + dedupes (mid → tid → uid) and scans the full Auth user list —
  its cost grows with the OTP user base.
- CLI parity for grants: `pnpm --filter @cmt/portal grant:admin
  grant|revoke|list <email-or-phone>` (and `grant:welcome-team`) do exactly
  the same writes as the UI — UAT-guarded, `--allow-prod` to override.
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
- Calendar seeding script: `pnpm --filter @cmt/portal
  seed:bala-vihar-calendar` — contains the hardcoded Brampton 2025-26
  season; edit it for a new year or location.
- Redirect shims: `/admin/donation-periods` → `/admin/programs`,
  `/admin/welcome-team` → `/admin/users`, `/admin/welcome` → `/welcome`,
  `/check-in/admin/reports` → `/welcome/reports`.
- Legacy `/check-in/admin/*` needs `NEXT_PUBLIC_FEATURE_CHECK_IN` +
  `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN`; the themed `/admin/*` surfaces have
  no feature flags (role-gated only).
- E2E: `e2e/setu/admin/*.spec.ts` covers roster/reports; the users & roles
  grant/revoke flow has route tests but no browser E2E (gap).
