# Academic School-Year Context — Phase 2 Design

**Date:** 2026-06-23
**Status:** Approved (brainstorm) — pending spec review → implementation plan
**Scope (v2):** Bala Vihar. Builds on **Phase 1** (shipped at `772e3b1`: live-year
`SchoolYearBadge`, the Year center, gated **Activate**, `cloneCalendarYear`,
`computeYearReadiness`). Phase-1 design: `docs/superpowers/specs/2026-06-23-academic-school-year-context-design.md`.

## Problem (recap)

Phase 1 made the live year visible and gave admins a once-a-year transition
(prepare → promote → Activate). Phase 2 finishes the "operate like a real school
management system" picture: let admin/welcome **view and prepare any year**
(not just live → next), give every year-scoped surface a **year selector**, add
the remaining **copy-from-last-year** affordances so admins don't re-create, let
admins read **past years** read-only, and close the latent bug where copied
**preparing-year** calendar entries leak onto families' screens.

## Decisions locked (from brainstorm)

1. **One cycle** — switcher + year-scoped reads + copy-from-last-year + past-year
   history are designed and planned together (one spec, one plan; the plan may
   internally sequence the tasks).
2. **Year carrier = URL query param `?year=YYYY-YY`.** Server pages read it from
   `searchParams`; absent → defaults to the live year. Survives reload + soft
   nav, shareable/bookmarkable, no new client store.
3. **All carry-forward is OPTIONAL.** The admin can carry over everything, some,
   or **nothing**. No copy runs automatically; each is an opt-in action. "Start a
   fresh year with nothing carried" is a first-class path.
4. **Mobile-ready.** Family-facing effects are exposed via `/api/setu/*`
   (Bearer+cookie auth via `readSessionFromHeaders`, ISO-string JSON, shared
   `@cmt/shared-domain` schemas), and **every contract-affecting change appends a
   dated, SHA-keyed `apps/portal/docs/MOBILE_API_CHANGELOG.md` entry** (the mobile
   repo's `contract-sync` cron consumes it). Admin-only switcher/copy/Activate
   routes are `/api/admin/*` — web-only, no mirror.
5. **`?year=` allowed set = derived from data** — the selectable years come from
   the existing offering `termLabel`s (only years that actually have data); an
   out-of-set/absent param falls back to the live year.
6. **Past-year writes are hard-rejected** at the write route via a shared
   `assertLiveYear` guard (not merely hidden in the UI).
7. **Seva copy is selective + date-deferrable** — see §4 (per-item pick, +364d
   suggested date, or "decide date later" → unscheduled draft).

## The model

- **Live year** = `app_config/school_year.currentYear` (Phase 1) — the single
  server truth families/teachers operate in; flips only at **Activate**.
- **Viewing year** = the `?year=` selection (admin/welcome only), a UI filter over
  the already-year-tagged data; defaults to the live year.
- **Status is derived**, never stored: **Past** (`year < live`), **Live**
  (`year == live`), **Preparing** (`year > live`).
- A shared helper `resolveViewYear(searchParams, liveYear)`
  (`features/setu/rollover/view-year.ts`) parses + validates `?year=` against the
  known set of years (offering `termLabel`s), falls back to the live year on a
  bad/absent value, and returns `{ year, status }`. **Every** year-scoped surface
  resolves the year through this one helper so they can never disagree.

## Components

### 1. Year switcher (admin shell)
The Phase-1 `SchoolYearBadge` becomes an interactive control: a small dropdown of
Past / Live / Preparing years (derived from existing offering `termLabel`s, live
marked). Selecting a year navigates to the same path with `?year=` set (a client
`<Link>`/router push preserving the current route). When the selected year ≠ live,
a clear strip renders — **"Preparing 2026-27 — not live yet"** or **"Past year —
read-only"** — so a planning/history context is never mistaken for live.
Welcome-team sees the switcher; **only admin** sees Activate (in the Year center).

### 2. Year-scoped surfaces
These BV admin/welcome surfaces read the selected year via `resolveViewYear` and
scope their existing reads to it: **Level management, Class calendar, Prasad,
Seva, Reports, and the roster/enrollments view.** Scoping reuses the year tags
already on the data (offerings/levels by `termLabel`/`pid`, calendar by
`schoolYearDateRange`, seva by `sevaYear`, prasad by the year's oid). **Year-
agnostic** surfaces get **no** switcher: Program *definitions*, Volunteering
skills, Users & roles.

### 3. Family/teacher calendar fix (B) — family-facing
`getPublishedCalendar` / `getUpcoming` (`features/setu/calendar/calendar.ts`) gain
a **live-year lower bound** (`schoolYearDateRange(liveYear).start`) so preparing-
year (future) Sundays stay hidden from families until Activate flips the live
year. `getClassDatesHeld` (the attendance denominator) already filters
`date <= today`; the same lower bound is added for correctness. This is the fix
for the Phase-1 cloned-`enabled` exposure (chosen over cloning `enabled:false`).
**It changes `GET /api/setu/calendar` output → `MOBILE_API_CHANGELOG` entry.**
Covered by an N=2-years fixture test (two school years of entries; assert only
live-year-onward come back and the denominator is unaffected).

### 4. Copy-from-last-year (C) — every action OPTIONAL
The Year center's readiness rows each offer an **idempotent, opt-in** copy into
the selected **Preparing** year. The admin runs whichever they want and can skip
all of them (start fresh). Nothing is automatic.
- **Levels + offerings** — the existing **Start** (`startNewYear`); already a
  button (optional). Skipping it means creating next-year offerings/levels by hand
  via Programs/Level management.
- **Class calendar** — the existing Phase-1 **Copy calendar** (`cloneCalendarYear`).
- **Prasad config** — new: clone `prasadConfig/{oid}` (cap per Sunday) to the
  next-year oids (pid == offering oid).
- **Seva opportunities** — new, **selective** (seva is mostly decided fresh each
  year, so this is a "pull a few recurring items forward" tool, not a bulk copy):
  the admin picks which of last year's `seva_opportunities` to bring into the new
  `sevaYear`. Each copied item defaults its `date` to **+364 days** (same weekday)
  as a suggestion the admin can keep or change; or the admin marks **"decide date
  later"**, which copies the item as an **unscheduled draft** — hidden from
  families until the admin sets a real date and opens it. (Plan resolves the
  draft representation — an additive `unscheduled`/`draft` state vs a nullable
  `date` — with the schema-read-safety + mobile-contract audit; the family seva
  read + `GET /api/setu/seva/opportunities` must keep excluding drafts.)
- **Teacher pre-fill** — new, **opt-in**: copy each level's `teacherRefs` into the
  matching next-year level (today `startNewYear` deliberately resets them to
  empty). Never silently re-assigns.
Each row shows ✓/✗ readiness (Phase 1) plus its "Copy from last year" action;
once run, the row flips to ✓.

### 5. Past-year read-only history (D)
Selecting a **Past** year shows that year's data **read-only** across the year-
scoped surfaces (Reports, roster, Level management, Class calendar) — the same
reads, just an older `?year=`. Mutations are disabled for non-live years: the UI
renders a read-only state, and write routes **reject a non-live target year**
(shared guard). No new storage — history is the year-tagged docs already present.

### 6. Mobile API contract
- **Live-year exposure** — add `schoolYear: string` (the live year) to
  `GET /api/setu/dashboard` (the mobile home screen) so the app can render the
  live-year label — the mobile counterpart of the Phase-1 web badge, which shipped
  with no API field. Add to the shared dashboard response schema. →
  `MOBILE_API_CHANGELOG` entry.
- **Calendar scoping** — `GET /api/setu/calendar` now returns only live-year-
  onward entries (§3). Shape unchanged, content filtered. → `MOBILE_API_CHANGELOG`
  entry (so the mobile mirror's tests/fixtures expect the filtered set).
- **Web-only** — the year switcher, the copy-* endpoints, and Activate are
  `/api/admin/*`: admins don't use the mobile app for rollover, so no mirror and
  no changelog entries for those.
- **Discipline** — every contract-affecting Phase-2 commit appends a dated, SHA-
  keyed `MOBILE_API_CHANGELOG` entry ("what changed + what the mobile must do");
  new family-facing handlers use `readSessionFromHeaders` (Bearer+cookie), ISO
  JSON, and shared schemas.

## Permissions & routes

- View/switch any year + run the copies: **admin + welcome-team**.
- **Activate:** admin only (unchanged).
- New copy endpoints under `/api/admin/school-year/copy-*` (prasad, seva,
  teachers) — covered by the existing `/api/admin/*` admin catch-all in
  `canAccessRoute`; admin-gated in-handler via `isAdmin`/`isWelcomeTeam` helpers.
- Year-scoped reads keep their existing role gates.
- Past-year writes rejected (non-live target) at the write route.

## Testing

A deployed-UAT Playwright E2E with a **multi-year fixture** (a Live year + a
Preparing year with partial data + a Past year) that walks: switch to Preparing →
run each optional copy (prasad/seva/teachers) → assert each surface reflects the
selected year → switch to Past → assert read-only (a mutation is rejected) →
assert the **family** calendar and `GET /api/setu/calendar` do **not** show
preparing-year Sundays → assert `GET /api/setu/dashboard` exposes `schoolYear`.
**Non-destructive** re: shared `app_config` (no Activate in the E2E — per the
standing preference; the clean rollover state stays intact). **Index audit** on
every new year-filtered query (UAT-only deploy, no `--force`). A mobile-bearer E2E
covers `dashboard.schoolYear` + the calendar scoping.

## Non-goals / deferred

- Other programs (Tabla, chanting) — BV-first; extend later.
- A year **switcher on family/teacher** surfaces — they stay **live-year only**
  (the switcher is an admin/welcome planning tool). Families/teachers see only a
  read-only live-year label.
- GET-readiness caching — stays **skipped** (prior SHIP-review decision: low value,
  stale-checklist risk).

## Open questions for the plan

- Whether the switcher is one shared shell control vs rendered per-surface, and
  exactly where the "Preparing/Past" strip renders.
- The seva-copy **draft representation** for "decide date later" — an additive
  `unscheduled`/`draft` state vs a nullable `date` — chosen with the
  schema-read-safety + mobile-contract audit (family reads + `GET /api/setu/seva/
  opportunities` must exclude drafts).
- Whether the plan should internally sequence into sub-slices (foundation → copies
  → history) even though it's one spec/cycle.
