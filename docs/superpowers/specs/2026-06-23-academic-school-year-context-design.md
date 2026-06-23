# Academic School-Year Operating Context — Design

**Date:** 2026-06-23
**Status:** Approved (brainstorm) — pending spec review → implementation plan
**Scope (v1):** Bala Vihar only
**Owner decision log:** see "Decisions locked" below

## Problem

The Bala Vihar admin work is inherently scoped to a *school year* (offerings,
levels, class calendar, prasad, seva, enrollments, reports all belong to a year),
but the app surfaces almost none of that. Only two places read the active year
(`app_config/school_year.currentYear`): the prasad rotation and the rollover page.
Everywhere else, the year is buried inside document IDs (`bv-brampton-2025-26`)
and nothing tells the admin **which year they are planning for**. The year-to-year
transition (set up next year → promote kids → go live) is split across
disconnected tabs with no anchor, and there are no "copy from last year"
affordances, so admins re-create structure by hand. Operating it "like a real
school management system" means: one visible live year everyone shares, a clean
once-a-year transition, and the ability to prepare next year without re-creating.

## Decisions locked (from brainstorm)

1. **Scope:** Bala Vihar first. (Other programs deferred.)
2. **Year model:** a single **live year** that families/teachers/everyone share,
   plus an admin/welcome **planning context** to prepare *next* year ahead of time;
   a deliberate **Activate** flips the live year for everyone.
3. **Family/teacher visibility:** a clear read-only **label/badge** of the live
   year. No data-gating change to family/teacher surfaces (their data already
   follows their own active enrollment/roster).
4. **Copy-from-last-year covers:** levels + offerings, class calendar, prasad
   config, teacher assignments, **and admin-created seva opportunities**.
5. **Permissions:** Admin + welcome-team can view/switch the planning context and
   prepare next year; **only Admin can Activate** (promote + flip the live year).
6. **Approach:** "A" — a global year context + a reborn **Year center** hub, built
   in two phases.

## The model

- **Live year = the single server truth** = `app_config/school_year.currentYear`
  (already exists; read via `getSchoolYearConfig`). It is what families, teachers,
  and everyone operate in. It changes **once a year, only at Activate**.
- **The viewing/planning year is a UI selection, not new server state.** Every
  year-scoped doc is *already* tagged by year — offerings carry `termLabel`,
  levels `periodLabel` (+ `pid`), enrollments `termLabel`/`oid`,
  `seva_opportunities` carry `sevaYear`, prasad docs carry `pid`/period,
  `classCalendarEntries` are date-based. So "show year X" is a filter on existing
  data. The admin's selected year defaults to the live year.
- **Year status is derived, not stored.** Comparing a year to the live year yields
  **Past / Live / Preparing** (Preparing = a future year that has some data but is
  not yet live). No new schema field.
- **Seva-year alignment.** Seva currently has its *own* year config
  (`app_config/seva_requirement.currentSevaYear`) decoupled from the school year —
  this is what caused the `/family/seva` 500 when it was set independently. On
  **Activate**, the school-year transition sets `currentSevaYear` = the new school
  year, so seva follows the school year and the two can never drift again.

## Components

### 1. Year context (admin shell)

- A **year control pinned at the top of the Bala Vihar admin area**:
  `School year: 2025-26 · Live ▾`, with a dropdown to select Past / Live /
  Preparing years. Selecting a year sets the admin's **viewing context** (carried
  across the BV admin surfaces — e.g. via a shared context provider + a URL/query
  param so it survives navigation and reload).
- An **always-visible badge** of the selected year; when the selected year is not
  the live year, a clear **"Preparing 2026-27 — not live yet"** strip so a planning
  context is never mistaken for live.
- **Welcome-team** can view and switch the context (view/plan) but sees no Activate.
- **Admin** sees Activate (in the Year center).

### 2. Family/teacher label

- A small, read-only **"School year 2025-26"** label on the family dashboard and
  teacher screens, reflecting the **live** year only (i.e. it updates to 2026-27
  the moment an admin Activates). No behavior/data change —
  this is a visible anchor, not a filter.

### 3. Year-scoped surfaces + "Copy from last year"

- These BV admin surfaces read the **selected** year and show that year's data:
  **Level management, Class calendar, Offerings (under Programs), Prasad, Seva,
  Reports, Enrollments view.**
- When a surface is **empty for a future (Preparing) year**, it shows a
  **"Copy from {previous year}"** action that clones the previous year's data into
  the selected year:
  - **Levels + offerings** — reuse the existing rollover engine (`startNewYear` in
    `features/setu/rollover/start-new-year.ts`), which already clones BV offerings
    + levels +1 year, idempotently, preserving existing target docs.
  - **Class calendar** — clone the Sunday schedule + weekly times, shifting dates
    +1 year (new helper).
  - **Prasad config** — clone caps/rotation settings into the new period (new
    helper).
  - **Seva opportunities** — clone admin-created seva opportunities for the new
    `sevaYear` (new helper).
  - **Teacher assignments** — *optional* pre-fill last year's teacher-per-level as
    a starting point (today `startNewYear` deliberately resets `teacherRefs` to
    empty; add an opt-in "carry teachers over").
- **Year-agnostic** surfaces — Programs *definitions*, Volunteering skills,
  Users & roles — get **no** year control (they are not year-scoped).

### 4. The Year center (transition hub) + Activate

- Today's `/admin/school-year` is reborn as the **Year center** — the single home
  for the once-a-year lifecycle:
  - A **readiness checklist** for the next year — Levels · Offerings · Calendar ·
    Teachers · Prasad · Seva — each item shows ✓/✗ and a "Copy from last year" /
    "Go set up" link.
  - **Promote kids** — the existing dry-run preview → commit (`promoteFamilies`):
    advance grades, create next-year enrollments, file this year as history,
    graduate Grade 12, flag "needs attention" (missing-grade) kids with the inline
    grade fix.
  - **Activate** (admin-only): atomically flips the live year
    (`currentYear` → next), aligns `currentSevaYear`, and confirms the once-a-year
    switch. **Guardrail:** Activate is blocked/warned if promotion has not been run
    for the target year — this enforces the correct order (promote *then* flip) in
    the flow rather than relying on the admin remembering it.

## Phasing

The full design is delivered in two implementation cycles (each gets its own plan):

- **Phase 1 (core):** year context + badge in the admin shell; family/teacher
  live-year label; Year center hub with the readiness checklist, the existing
  promote flow, and **Activate** (flip live year + align seva year, with the
  promotion guardrail); **copy-from-last-year for levels/offerings (reuse engine)
  and class calendar.**
- **Phase 2 (completeness):** copy-from-last-year for **prasad + seva + optional
  teacher pre-fill**; per-surface year **switching** on Level management / Class
  calendar / Prasad / Seva / Reports; past-year **read-only history** view.

## Permissions & routes

- Year context + planning: **admin + welcome-team** (view/switch/prepare).
- **Activate:** admin only. Reuses the existing `/api/admin/school-year` family of
  routes (admin-gated via `canAccessRoute` `/api/admin/*` + handler `isAdmin`
  re-check). The new Activate endpoint sets `currentYear` and `currentSevaYear`
  together.
- Year-scoped reads on welcome surfaces stay welcome-team-gated as today.

## Non-goals / deferred

- Other programs (Tabla, chanting, …) — BV-first; extend later.
- A more prominent "year setup" landing page / forced year-picker on first admin
  entry — the badge + Preparing strip is the agreed v1 visibility; revisit if the
  badge proves too subtle.
- Data-gating family/teacher surfaces to arbitrary years (label only in v1).

## Technical grounding (existing building blocks)

- `app_config/school_year.currentYear` + `getSchoolYearConfig`/`setSchoolYearConfig`
  (`features/setu/rollover/school-year-config.ts`), routes `/api/admin/school-year`
  (+ `/start`, `/promote`, `/set-grade`).
- `app_config/seva_requirement.currentSevaYear` (`lib/seva-requirement.ts`).
- Rollover engine: `start-new-year.ts` (clone offerings + levels +1 year, idempotent,
  preserves target docs/teacherRefs), `promote-families.ts` (grade-driven promotion,
  history-preserving, idempotent, dry-run preview).
- Year fields already present: offerings `termLabel`, levels `periodLabel`/`pid`,
  enrollments `termLabel`/`oid`, `seva_opportunities.sevaYear`, prasad `pid`/period,
  `classCalendarEntries` (date-based).
- Family dashboard scopes BV via `selectBalaViharEnrollment` (active enrollment),
  teacher rosters by `levelId` — both already follow the family's/level's year, so
  the family/teacher label is additive only.

## Testing

Per the project disciplines (`verifying-setu-changes-in-uat`,
`auditing-firestore-indexes`): each phase ships with a **deployed-UAT Playwright
E2E** that seeds a **realistic multi-year fixture** (a live year + a Preparing year
with partial data) and walks the admin through prepare → copy-from-last-year →
promote (dry-run) → Activate, asserting the live year flips and the family/teacher
label updates. Any new filtered/compound Firestore query (year-scoped surface
reads) is checked against `firestore.indexes.json` and deployed to UAT only.

## Open questions for the plan

- Exact carrier for the selected viewing year (React context + URL query param vs
  cookie) — resolve in the Phase 1 plan; must survive reload and soft nav.
- Whether the readiness checklist's "ready" thresholds block Activate or only warn
  (default: block on "promotion not run", warn on missing calendar/teachers).
