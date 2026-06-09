# Admin Section Revamp — Design

**Date:** 2026-06-08
**Status:** ⏳ Approved design, not yet planned/implemented
**Author:** CMT Developer (with Claude)

## Goal

Restructure the portal's admin area so CMT staff and welcome-team volunteers can
understand it at a glance: one clear information architecture, a single unified
**Users & Roles** tool, a browsable **Roster** (replacing single-shot family
search), a renamed **Level management** screen, and a consolidated **Reports
hub**. This is a usability/IA revamp on top of the existing fixed-role auth
model — *not* a new permission engine.

## Origin (team feedback, 2026-06-08)

The admin section was shown to the CMT team. Their feedback, verbatim intent:

1. Confusing overall — want something simpler to **manage roles** and **users**;
   be able to see **what access a user has**, see **which roles exist**, and
   create/edit role assignments.
2. Remove the **"Welcome-team grants"** module; make it a **common user/role
   management** module instead.
3. **"Levels & teachers"** name is misleading — it's level configuration, not
   teacher HR. Rename to something meaningful (**Level management**).
4. Remove the **"Family search"** section; instead give admins a way to see the
   **full roster** (all families/members), like the legacy excel→RTDB roster.
5. Whatever **reports** we support, **admin AND welcome-team** should be able to
   generate them.

## Decisions locked (design review, 2026-06-08)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Roles module scope | **Assign from the fixed role set + a roles reference.** No custom-RBAC engine. |
| D2 | Roster data source | **Setu `families` collection** (portal-native, go-forward). Zero RTDB dependency for 2026-27. A migration-completeness check confirms 2025-26 families are fully migrated first. |
| D3 | Roster view shape | **Families list → drill to member detail.** Search is a filter on this screen. CSV export emits a flat people list. |
| D4 | Reports v1 | **All four**: roster/enrollment, donations summary, attendance summary, keep legacy check-in CSV. |
| D5 | Donations report visibility | **Admin-only** within the Reports hub (privacy: per-family giving isn't exposed to all welcome-team volunteers). Roster/enrollment + attendance reports are admin **and** welcome-team. |
| D6 | Phasing | **4 independently-shippable phases** (IA → Users&Roles → Roster → Reports). |

## Why not a custom-role engine (the load-bearing constraint)

Access control is **code-defined, not data-defined**. `canAccessRoute`
(`packages/shared-domain/src/auth/can-access-route.ts`) is a hardcoded sequence
of `pathname.startsWith(...) → isAdmin/isWelcomeTeam/isTeacher/...` checks.
Roles are a fixed `ROLES` union (`packages/shared-domain/src/auth/role.ts`):
`admin, teacher, family, family-manager, family-member, welcome-team`. They live
only in Firebase Auth custom claims (`role` primary + `extraRoles[]`); there is
no Firestore mirror.

A true "admins define new roles with custom permission sets" feature would
require rewriting the entire authorization layer to be data-driven across every
route — large, risky, and beyond what the team needs. So the roles module
**surfaces** the fixed set transparently and lets admins **assign** them; it does
not invent new role types.

## Current-state map (what exists today)

- **Roles stored:** Firebase Auth custom claims only. Enumerate via
  `portalAuth().listUsers(1000, pageToken)` (paginated), inspect `customClaims`.
- **Capability helpers:** `apps/portal/src/lib/auth/role-claims.ts` —
  `hasCapability`, `addCapability`, `removeCapability` (typed `Capability =
  'admin' | 'welcome-team'`), keeping family roles in the primary slot.
- **Three fragmented grant screens** (the problem):
  - `/admin/welcome-team` → grant/revoke **welcome-team** (`POST /api/admin/welcome-team`, `DELETE /api/admin/welcome-team/[uid]`).
  - `/check-in/admin/users` → grant/revoke **admin** (legacy, themed-less).
  - `/check-in/admin/welcome-team` → legacy welcome-team mirror.
- **Teacher capability** is granted a 4th way: assigning a level on
  `/admin/levels` writes `teacherAssignments/{ref}` (ref = member `mid` or
  standalone `tid`); the `teacher` capability is computed at next sign-in.
- **Family search:** `searchFamilies(q)` (`apps/portal/src/features/setu/search/search-families.ts`)
  queries `families` by fid / legacyFid / `searchKeys` array-contains / contactKey
  hash — one criterion at a time. No "browse all". UI at `/welcome`.
- **Reports:** only legacy CSV exports — `/check-in/admin/reports` →
  `POST /api/check-in/admin/reports/[kind]` for `check-ins` + `guests` (door-app
  data in 715b8). Reusable CSV pattern: `toCsv(rows)`
  (`apps/portal/src/features/check-in/teacher/csv.ts`) + `ReportExportButton`
  (fetch → blob → `a.download`). No Setu-native donations/attendance/enrollment
  reports.
- **Admin chrome:** `AdminSidebarLive` + `deriveAdminActive`
  (`apps/portal/src/features/admin/components/admin-sidebar.tsx`); admins keep
  admin chrome on `/welcome/*` pages (already wired in `welcome/layout.tsx`).
  Mobile: `admin-mobile-nav.tsx`, `welcome-mobile-nav.tsx`.

## Firestore data sources (collection names confirmed)

- `families/{fid}` — `{ fid, legacyFid, name, location, managers[], searchKeys[], createdAt }`.
- `families/{fid}/members/{mid}` — `MemberDoc` (firstName/lastName, type, schoolGrade, etc.).
- `enrollments/{eid}` (+ `collectionGroup('enrollments')`) — `EnrollmentDoc` (fid, oid, pid, programKey, programLabel, termLabel, status, location).
- `donations/{did}` — `DonationDoc` (fid, amountCAD, status ∈ redirected/completed/abandoned, programKey, pid, createdAt).
- `attendanceEvents/{aid}` (+ `collectionGroup`) — `AttendanceEventDoc` (levelId, pid, fid, mid, date, status ∈ present/absent/late).
- `levels/{levelId}` — level config (programKey, location, levelName, pid, gradeBand[], teacherRefs[]).
- `teacherAssignments/{ref}` — `{ ref, levelIds[], updatedAt, updatedByUid }`.

---

# New Information Architecture

Admin home (`/admin`) is reorganized from **13 flat tiles** into **four labelled
groups**. The admin sidebar nav (`ADMIN_NAV`) and both mobile navs follow the
same grouping.

```
PEOPLE & ACCESS          BALA VIHAR                 REPORTS              LEGACY · DOOR APP
─────────────────        ──────────────────────     ─────────────       ──────────────────
• Users & roles  (NEW)   • Level management (renamed)• Reports hub (NEW)  • Check-in dashboard
• Roster         (NEW)   • Programs                                       • Guests
                         • Class calendar                                 • Unpaid families
                         • School-year rollover                           (de-emphasized,
                         • Volunteering skills                             marked Legacy)
                         • Seva
```

**Retired/redirected tiles:** "Welcome-team grants", legacy "Admin users",
legacy "Reports", "Donation periods" (already redirects to Programs). Each old
URL 301/route-redirects to its successor so bookmarks survive (mirrors the
existing `donation-periods → programs` pattern).

**Route → role matrix (new + changed):**

| Route | Page/API | Access |
|-------|----------|--------|
| `/admin/users` | Users & Roles screen | admin |
| `GET/POST /api/admin/users` | list users / grant role | admin |
| `DELETE /api/admin/users/[uid]/roles/[role]` | revoke a capability | admin |
| `/admin/levels` | Level management (renamed) | admin (page); assignment API stays admin+welcome-team |
| `/welcome/roster` | Roster browse | welcome-team + admin |
| `GET /api/welcome/families` | list/filter families (paginated) | welcome-team + admin |
| `/welcome/reports` | Reports hub | welcome-team + admin (donations card admin-only) |
| `GET /api/welcome/reports/[kind]` | report data + CSV | welcome-team + admin; `kind=donations` → admin only |

All new `/api/welcome/*` paths need **explicit `canAccessRoute` rules** (the
`/api/setu/*` catch-all does not cover `/api/welcome/*`; `/api/admin/*` is
already admin-only via its catch-all).

---

# Phase 1 — IA Restructure

**Outcome:** the admin area *reads* clearly even before the new tools land.

- **`/admin` dashboard** (`app/admin/page.tsx`): replace the flat 13-tile grid
  with 4 titled sections (People & Access, Bala Vihar, Reports, Legacy · Door
  app). Tiles for not-yet-built tools (Users & roles, Roster, Reports hub) link
  to their target routes — Phase 1 may ship them as labelled placeholders or be
  sequenced so Phase 1's tiles point at Phases 2–4 as they land. Keep legacy
  tiles visually de-emphasized with a dated "retiring after door cutover" note.
- **Rename** "Levels & teachers" → **"Level management"** everywhere: the
  `/admin/levels` page `<h1>` and eyebrow, the `metadata.title`, the
  `ADMIN_NAV` label, and any mobile-nav label. Update the dashboard tile copy.
  Behavior unchanged (still configures levels + assigns teachers; the body copy
  clarifies "assign the teachers who cover each level").
- **`ADMIN_NAV` reorg** (`admin-sidebar.tsx`): regroup into the four sections
  with subtle group headers; rename "Family search"→"Roster"
  (`/welcome/roster`), "Welcome-team grants"→"Users & roles" (`/admin/users`),
  point "Reports" at `/welcome/reports`. Keep legacy items under a "Legacy"
  group. Extend `deriveAdminActive` to map the new routes.
- **Mobile nav parity** (`admin-mobile-nav.tsx`, `welcome-mobile-nav.tsx`):
  surface Users & roles / Roster / Reports appropriately.
- **Redirects:** `/admin/welcome-team` and `/check-in/admin/users` →
  `/admin/users`; legacy `/check-in/admin/reports` tile points to
  `/welcome/reports` (the page itself can stay until Phase 4 lands, then
  redirect).

**Tests:** `deriveAdminActive` mappings for the new routes; `ADMIN_NAV`
renders the renamed labels with correct hrefs; redirect routes resolve.

---

# Phase 2 — Users & Roles (items 1 + 2)

**Replaces** "Welcome-team grants" and legacy "Admin users" with one screen at
`/admin/users` (admin-only).

## ⚠️ Real role model (corrected 2026-06-08 after reading `build-session-claims.ts`)

Roles are **NOT** Firebase-Auth-claims-only. The authoritative resolution
(`apps/portal/src/features/setu/auth/build-session-claims.ts`) merges **three
grant sources** into a session, **person-centric (keyed by `mid`)** so a grant
holds across a person's separate email/phone auth UIDs:

1. **`roleAssignments/{mid}`** — `{ mid, fid, roles: ('admin'|'welcome-team')[], grantedAt, grantedVia }`.
   The canonical path for **family-member** staff. Helpers:
   `getMemberRoles` / `addMemberRole` / `removeMemberRole` / `listMembersWithRole`
   (`features/setu/auth/member-roles.ts`).
2. **Firebase Auth custom claims** on `sha256(canonicalContact)` — the legacy
   path for **non-family** CMT staff (no Bala Vihar family). Helpers:
   `addCapability` / `removeCapability` / `hasCapability` (`lib/auth/role-claims.ts`).
3. **`teacherAssignments/{ref}`** (ref = `mid` or standalone `tid`) — the teacher
   capability + its `levelIds`; computed at session-build, not pushed to claims.

`build-session-claims` rules: family role wins the **primary** slot;
admin/welcome-team/teacher go to `extraRoles`; **admin inherits welcome-team +
teacher**. The proven dual-path grant/revoke/list logic already exists in
`scripts/grant-admin.ts` — Phase 2 **extracts it into a shared server module**
(`features/setu/auth/manage-roles.ts`) that BOTH the CLI and the new API call
(DRY; single source of truth for the contact→mid-or-uid routing).

## Data model

A `StaffRow` assembled server-side by **merging all three grant sources and
deduping by person** (mid when known, else contact-uid):

1. **`roleAssignments`** — read all docs (or `where('roles','array-contains', …)`
   twice); for each `mid` resolve name/contact from `families/{fid}/members/{mid}`.
2. **Firebase Auth claims** — `listUsers()` paginated; keep users whose claims
   carry admin/welcome-team **and** have no `mid`-backed family (non-family staff).
   Family members granted via the legacy path historically may appear in BOTH —
   dedupe by resolving their `mid`.
3. **`teacherAssignments`** — read all docs; mark `isTeacher`, join `levels` for
   level names. `tid`-only teachers (no family) resolve via `teachers/{tid}`.

```ts
interface StaffRow {
  key: string;                 // mid when known, else uid — the dedupe key
  mid: string | null;
  fid: string | null;
  uid: string | null;          // contact-derived auth uid (non-family staff)
  name: string;                // resolved member/teacher name, or email
  contact: string;             // email/phone for display
  roles: Array<'admin' | 'welcome-team'>;   // effective grants (deduped)
  isTeacher: boolean;
  teacherLevels: string[];     // level names, for display
  source: 'family' | 'staff';  // which grant path backs this person
}
```

The list is **staff-only by construction** (it reads grant collections, not all
auth users), so it isn't drowned by family accounts. A search box filters
by name/contact; role chips filter by Admin / Welcome-team / Teacher.

## Screen (`/admin/users`)

- **Header + search box** (filter by name/contact).
- **Role filter chips**: All staff · Admin · Welcome-team · Teacher.
- **Staff list**: name/contact, role badges (admin / welcome-team / teacher with
  its levels), and which path backs them. Each row expands to **"What can this
  person access?"** — a plain-English summary derived from their effective roles.
- **Add staff**: enter email/phone → server resolves whether they're a Setu
  family member (`findSetuFamilyByContact`) and routes the grant to the correct
  path (`roleAssignments/{mid}` for family, auth-claims for non-family) — exactly
  as `grant-admin.ts` does today, now via the shared module. Choose admin or
  welcome-team.
- **Per-row actions**: grant/revoke admin, grant/revoke welcome-team (dual-path);
  "Manage as teacher" → deep-links to Level management (teacher stays granted by
  level assignment — single source of truth). Guards: **cannot revoke your own
  admin** (self-lockout); **warn on revoking the last admin**.
- **Roles reference panel** (static, curated): one card per role in `ROLES` with
  what it grants, authored from `canAccessRoute`.

## API

- `GET /api/admin/users` → `{ staff: StaffRow[] }` (merges all three sources,
  deduped). Admin-only (covered by `/api/admin/*` catch-all).
- `POST /api/admin/users` `{ contact, role: 'admin' | 'welcome-team' }` → grant
  via the shared module (auto-routes family→`roleAssignments`, non-family→claims).
  201 with the resulting `StaffRow`.
- `DELETE /api/admin/users/roles` `{ key, role }` (or `…/[key]/roles/[role]`) →
  revoke that capability through the correct path, with last-admin / self-revoke
  guards.

All three reuse the shared `manage-roles.ts` module. The existing
`POST/DELETE /api/admin/welcome-team` routes become thin shims over it (or are
removed once the UI/CLI no longer call them). `grant-admin.ts` is refactored to
call the shared module so CLI and UI never diverge.

## Mobile

Real `block md:hidden` layout: stacked user cards with role badges, expandable
access summary, add/grant via a sheet. Same `GET /api/admin/users` feeds it.

**Tests:** `UserRow` assembly merges claims + teacher assignments (incl. a
user whose claims lack `teacher` but has an assignment — the N=2 read case:
two teacher assignments, two extraRoles); grant generalizes to both roles;
revoke last-admin guard; self-revoke guard; roles-reference renders every role
in `ROLES`.

---

# Phase 3 — Roster (item 4)

**Replaces** the single-shot family search with a browsable roster at
`/welcome/roster` (welcome-team + admin). The old `/welcome` search hero either
becomes this page or redirects to it; `searchFamilies` becomes the search filter.

## Browse query (Setu `families`)

- Default list: `families` ordered by `name` (asc), **cursor-paginated**
  (`limit(N)` + `startAfter(lastName)`); page size ~50. Needs a single-field
  `name` order — confirm whether a Firestore index entry is required and add to
  `firestore.indexes.json` if so (deploy **UAT only**, never `--force`).
- **Search**: reuse `searchFamilies(q)` — when the search box is non-empty, show
  search hits instead of the browse page.
- **Filters**:
  - **Location** — `where('location','==',loc)` (direct field).
  - **Program** — families with an active enrollment in program X. Resolve via
    `collectionGroup('enrollments').where('programKey','==',k).where('status','==','active')`
    → set of fids; intersect. (Index already exists for enrollments groups; add
    a `programKey + status` collectionGroup index if missing — UAT only.)
  - **Payment** — paid / outstanding. Derived from donations vs enrollment
    suggested amount for the active period (same logic the family dashboard
    uses; reuse the existing helper rather than re-deriving). MVP may ship
    location + program first and add payment if the derivation is cheap.
- Each row: family name · location · member count · payment chip. Member count
  via the members subcollection (as `searchFamilies` already does).

## Family detail (drill-down)

Reuse the **existing** `/welcome/family/[fid]` read-only detail page (members,
enrollment, donations, history). No new detail screen — just link rows to it.

## CSV export (flat people list)

`GET /api/welcome/families?...&format=csv` (or a sibling `/export` route)
streams a flat **one-row-per-person** CSV: family name, fid, member name,
type (Adult/Child), grade, location, program(s), payment status. Built with the
existing `toCsv` + `ReportExportButton` download pattern.

## Migration-completeness check (D2 — the team's trust concern)

A read-only reconciliation so staff can trust the portal DB is complete before
depending on it (no RTDB dependency for 2026-27):

- Read the **legacy 715b8 RTDB `/roster`** (READ-ONLY — never write 715b8) via
  the existing `family-lookup` RTDB reader; collect legacy family ids.
- Compare against Setu `families` (`legacyFid` field).
- Surface a small **"Migration status"** strip on the Roster screen and/or as a
  report card in Phase 4: "N of M legacy families migrated · K not yet in
  portal" with the ability to list the missing ones.
- If the UAT `families` collection is **not** already complete (verify the count
  first — the school-year rollover implies it is largely populated), run the
  existing bulk migrate script
  `scripts/migrate-legacy-families.ts` against **UAT only**
  (`pnpm --filter @cmt/portal exec tsx scripts/migrate-legacy-families.ts`),
  then re-check. This is an ops step in the plan, gated on the count, not a code
  feature. **Update `docs/runbooks/production-cutover-checklist.md` + §14
  change-log** if any UAT DB write happens.

## API + access

- `GET /api/welcome/families` → paginated `{ families, nextCursor }` with
  `?q=`, `?location=`, `?program=`, `?payment=`, `?format=csv`. **New
  `canAccessRoute` rule:** `isWelcomeTeam(claims)`.

## Mobile

Real mobile layout: search field on top, filter sheet, stacked family cards,
infinite scroll / "load more". Same API.

**Tests:** browse pagination (cursor) returns ordered pages; location/program
filters intersect correctly (N=2: a family with two active enrollments still
appears once); search-as-filter delegates to `searchFamilies`; CSV row-per-person
shape; reconciliation flags a legacy fid absent from `families`; new
`canAccessRoute` rule admits welcome-team + admin, denies family roles.

---

# Phase 4 — Reports hub (item 5)

`/welcome/reports` (welcome-team + admin). A hub of report cards; each renders
on-screen summary tables **and** a CSV export, reusing `toCsv` + the download
button pattern.

## 4a · Roster / enrollment report (welcome-team + admin)

- **Headcounts**: members per **level** and per **program** (active enrollments).
  Source: `collectionGroup('enrollments').where('status','==','active')` grouped
  by `programKey` / level; join `levels` for level headcounts.
- **Family/member CSV**: same flat export as Phase 3's roster CSV (shared
  helper).

## 4b · Attendance summary (welcome-team + admin)

- Per-**level** and per-**program** rollups over `attendanceEvents`: present /
  absent / late counts, attendance rate, by date range. Admin-level view over
  the single-level teacher screen. Source: `attendanceEvents` (filter by
  `pid`/`levelId`/`date` range).
- CSV export of the rollup.

## 4c · Donations summary (**admin-only** — D5)

- Totals by **donation period** (`pid`) and program; **paid vs outstanding**
  families (donations `status='completed'` vs enrollment suggested amounts);
  per-family amounts. Source: `donations` (+ `enrollments` for expected
  amounts). Note in the UI that accounting@ remains the settlement source of
  truth (no Stripe webhook).
- CSV export. **Card hidden / 403 for welcome-team.**

## 4d · Legacy check-in CSV (admin)

- Fold the existing `check-ins` + `guests` CSV exports into a card here (calls
  the existing `POST /api/check-in/admin/reports/[kind]`). The standalone
  `/check-in/admin/reports` page redirects here.

## API + access

- `GET /api/welcome/reports/[kind]` where `kind ∈ enrollment | attendance |
  donations | checkins | guests`; `?format=csv|json`, plus filter params
  (date range, program, location). **`canAccessRoute` rules:** the path is
  welcome-team + admin **except** `kind=donations` which the handler restricts
  to `isAdmin` (and the hub hides the card for non-admins). The legacy
  `checkins`/`guests` kinds proxy the existing admin reports route (admin-only).

## Mobile

Report cards stack; summaries render as compact tables; export via the same
button. Same APIs.

**Tests:** each report's aggregation (N=2 fixtures — two levels, two programs,
two periods — so no "first-only" bug); donations report returns 403 for
welcome-team and 200 for admin; CSV shapes; `canAccessRoute` rules per kind.

---

# Cross-cutting requirements

- **Mobile + mobile-API ready** (per project rule): every new screen has a real
  `block md:hidden` layout; every data source is a JSON API authed via
  `readSessionFromHeaders` (Bearer + cookie) returning ISO-string JSON, so the
  future mobile app reuses them. Shared request/response shapes live in
  `@cmt/shared-domain` where they cross the client/server boundary.
- **Roles via helpers** — `isAdmin`/`isWelcomeTeam`/`isTeacher`, never strict
  equality. `addCapability`/`removeCapability` for all claim mutations.
- **`canAccessRoute`** — add explicit rules for every new `/api/welcome/*` and
  `/api/admin/users*` path; add `canAccessRoute` tests in the **same commit** as
  each new route.
- **`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`** — conditional
  spreads, no `undefined` assigned to optionals.
- **Setu `.csp` token scoping** — anything outside a `CspRoot` (fixed bars,
  sheets) needs `className="csp"`.
- **UAT-only DB writes** (`chinmaya-setu-uat`); never write prod 715b8 outside a
  cutover window; RTDB `/roster` + door collections are READ-ONLY.
- **TDD**, frequent commits, designer pass on the new UI screens (Users & Roles,
  Roster, Reports), subagents on Opus, `git push` after each authorized commit,
  never `--no-verify`.

# Non-goals (explicit)

- No custom/dynamic role types or data-driven permissions (D1).
- No rewrite of `canAccessRoute` into a permission table.
- No change to how families authenticate or to family-facing screens.
- No new Stripe webhook for donation settlement (donations report stays
  best-effort with the accounting@ caveat).
- No prod (715b8) cutover in this work — UAT only. Cutover remains the separate
  runbook milestone.

# Testing strategy

- Unit/component tests ship in the **same commit** as the code (helpers,
  API routes, role gates, aggregations).
- **N=2 discipline**: every aggregate/read is exercised with two of the thing
  (two levels, two programs, two enrollments, two teacher assignments) to avoid
  "first-only" bugs.
- Pre-push gate (`typecheck && lint && test && build`) must pass; never bypass.
- Mock-free walkthrough in UAT before declaring each phase done (sign in, click
  the path, verify the data) — distinguish "tests pass" from "verified in UAT".

# File map (indicative — pinned in the implementation plan)

- **Auth/shared:** generalize `lib/auth/role-claims.ts` usage; new shared
  request/response types in `packages/shared-domain/src/setu/` (e.g.
  `admin-users.ts`, `roster.ts`, `reports.ts`); `can-access-route.ts` + tests.
- **Users & Roles:** `app/admin/users/page.tsx` (+ `error.tsx`), `features/admin/users/*`
  (list, add form, role badges, access-summary, roles-reference), `app/api/admin/users/route.ts`,
  `app/api/admin/users/[uid]/roles/[role]/route.ts`.
- **IA:** `app/admin/page.tsx` (grouped), `features/admin/components/admin-sidebar.tsx`
  (`ADMIN_NAV`, `deriveAdminActive`), `admin-mobile-nav.tsx`, `welcome-mobile-nav.tsx`;
  `app/admin/levels/page.tsx` rename; redirects under `app/admin/welcome-team/`
  and `app/check-in/admin/users/`.
- **Roster:** `app/welcome/roster/page.tsx`, `features/setu/roster/*` (browse,
  filters, csv), `app/api/welcome/families/route.ts`, reconciliation helper
  reading 715b8 RTDB (read-only).
- **Reports:** `app/welcome/reports/page.tsx`, `features/setu/reports/*`
  (aggregations + cards), `app/api/welcome/reports/[kind]/route.ts`.

# Phasing summary

1. **IA restructure** — grouped dashboard, "Level management" rename, nav
   reorg + mobile parity, legacy redirects. *(low-risk clarity win, lands first)*
2. **Users & Roles** — unified screen, generalized grant/revoke, teacher-merge,
   access summary, roles reference.
3. **Roster** — browse/filter/drill/export + migration-completeness check.
4. **Reports hub** — enrollment, attendance, donations (admin-only), legacy CSV.

Each phase is independently shippable, testable, and mergeable to `main`.
