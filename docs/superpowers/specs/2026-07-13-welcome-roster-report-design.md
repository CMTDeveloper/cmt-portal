# `/welcome/roster` single-page Bala Vihar report - design

**Date:** 2026-07-13
**Status:** Approved (design gate passed)
**Audience:** welcome-team + admin (unchanged from today's roster)

## Problem

Vaibhav asked (relayed): on `https://cmt-setu.vercel.app/welcome/roster`, "add filters
for enrollment, donation, level, etc so this can be used as single page report for
everything." His clarification pins the intent to **Bala Vihar reporting**:

- "how many kids are enrolled in Bala Vihar" - an enrolled-**children** count.
- "levels filter will be used for generating report per level" - kids per BV level.
- "donation report will be used for families who have donated for the bala vihar program."

So the ask is **counts and filtered lists over the whole roster** (kids per level,
families who donated), not just browsing families 50 at a time.

## Current state (what exists today)

- `/welcome/roster` (`apps/portal/src/app/welcome/roster/page.tsx` +
  `features/setu/roster/roster-browser.tsx`) - family-centric, name-ordered, **cursor
  pagination (50/page)** over ~880 families.
- Filters today: **Location**, **Program**. Free-text **search** (name/email/phone/FID)
  bypasses filters via `searchFamiliesClient`.
- Per-row derived signals via `deriveFamilyRosterSignals(fid, ctx)`:
  - `payment`: `paid | outstanding | unknown` (expected from active enrollments vs
    completed donations; legacy-paid fallback).
  - `bvEngagement`: `confirmed | registered | null` (issue #23 - active BV enrollment
    that has attended ≥1 class / has a completed BV donation / is legacy-paid ⇒
    confirmed; active BV but not yet ⇒ registered; no active BV ⇒ null).
- Data paths in `features/setu/roster/list-families.ts`: unfiltered/location →
  Firestore-ordered cursor + `count()`; program/year → collectionGroup enrollments
  intersect → in-memory sort + fid cursor.
- API `GET /api/welcome/families` (`RosterQuerySchema`) - JSON browse + `format=csv`
  (→ `build-csv-rows.ts`, one row per person). **This endpoint is roster-only** (browse
  via `fetchRosterClient`, CSV via `roster-export-button`; `migration-status` is a
  separate route). No other consumer.
- `?year=` scope resolves server-side (`resolveViewYear`) and passes through.

**Why the current shape can't answer the ask:** `payment`, `bvEngagement`, `level`, and
`grade` are either derived *after* pagination or live on the child's enrollment, not the
family doc. Filtering a 50-family page on them collapses it to a handful, and counts
would be per-page, not totals. Reliable "kids per level / families who donated" needs the
**whole** matched set.

## v1 scope decision (2026-07-13)

Ship **five filters**: Location, Program, Level, Grade, Payment - plus live counts and
filtered CSV export. These cover all three of Vaibhav's stated reports (enrolled BV kids,
per-level breakdown, families who donated for BV) and are all cheap bulk reads.

**Deferred to a fast-follow: the Status (Confirmed/Registered) engagement filter and the
Confirmed/Registered card chip.** Accurate engagement needs the door check-in half, which
lives in the standalone check-in app's Firestore (prod `715b8`) as a per-family
subcollection with **no bulk read path** - computing it for all ~880 families per report
load means an ~880-read fan-out against the shared prod DB. Teacher-marks-only would
under-report "Confirmed" (a door-only attendee shows Registered), which is misleading, so
we defer rather than approximate. Sections below describe the full design; the engagement
parts (builder read #6, the `bvEngagement` field, the `status` filter, the Status chip
row) are **out of v1** and called out inline.

## Approach (chosen)

**Bulk-load the full filterable dataset once; filter, count, and export client-side.**

One server pass does the same ~5-read collectionGroup join the CSV export already does,
plus a year-scoped attendance read for engagement, and returns lightweight rows. The
browser holds them, applies filters, shows live counts, renders incrementally, and the
CSV export honors the active filters. **No new Firestore indexes** - every input is a
bulk collection / collectionGroup read the codebase already performs elsewhere
(`build-csv-rows.ts`, `attendance-report.ts`).

Rejected alternatives:
- *Add filter chips to the paginated browse* - a page of 50 collapses after filtering and
  counts are per-page, not totals. Fails the "report" intent.
- *Separate server count endpoints per filter* - duplicates the bulk join and drifts from
  the list. One dataset, filtered in one place, is simpler and consistent.

### Single builder + single pure predicate (DRY)

- **`buildRosterReportDataset({ year? })`** (server, `server-only`) - the one bulk join.
  Returns `RosterReportFamily[]`, each carrying the family facts needed by **both** the
  JSON browse and the CSV export:
  - identity: `fid, publicFid, legacyFid, name, location, memberCount`
  - `payment: 'paid'|'outstanding'|'unknown'`
  - `bvEngagement: 'confirmed'|'registered'|null` **(DEFERRED - not built in v1)**
  - `programs: string[]` (active program labels)
  - `bvChildren: Array<{ mid, firstName, lastName, grade: string|null, levelName: string|null }>`
    - one per child in an **active Bala Vihar** enrollment (`enrolledMids` expanded,
      grade + levelName from the enrollment doc, name from the member doc).
  - `members: Array<{ firstName, lastName, type, grade }>` - all members, for the CSV's
    one-row-per-person output (adults included, as today).
  Reads (all bulk, in-memory join, index-free):
  1. `families` (optional nothing - always full set; `?year=` handled via the enrollment
     read, see below).
  2. `collectionGroup('members')` → group by parent fid.
  3. `collectionGroup('enrollments')` → keep `status==='active'`, group by fid; carry
     `programKey, programLabel, levelName, schoolGrade, enrolledMids, oid`.
  4. `collectionGroup('donations')` → keep `status==='completed'`, sum `amountCAD` by fid
     (and note BV via `programKey==='bala-vihar'` for the confirmed signal).
  5. `offerings` (`getAll` over active-enrollment oids) → live effective suggested amount
     for the payment computation + BV offering window for engagement.
  6. **Engagement (DEFERRED - not built in v1).** Would join `attendanceEvents` (cheap
     bulk) with door check-ins, but door check-ins have no bulk read (per-family
     subcollection in prod `715b8`). Deferred per the 2026-07-13 scope decision; the
     builder does NOT compute `bvEngagement` in v1.
  - Wrapped in `use cache` with a short TTL so re-visits are instant (filtering is
    client-side regardless).
  - `?year=` scope (two effects, mirroring `list-families.ts`):
    1. The set of enrollments treated as "active" is filtered to `termLabel === year`
       (in-memory, index-free) - this drives `programs`, `bvChildren`, `payment`, and
       `bvEngagement` for the scoped year.
    2. **Which families appear:** with the **live year (default / no `?year=`)**, the
       report lists **all families** (matches today's unfiltered browse, incl. families
       with no enrollment). With a **non-live year**, the list is restricted to families
       that had ≥1 year-scoped active enrollment (mirrors the `list-families.ts` year
       path).

- **`matchesRosterFilters(family, filters)`** + **`summarizeRoster(families, filters)`** -
  pure functions (no server/DOM imports) in `packages/shared-domain/src/setu/` so they are
  unit-testable and shared by the client (browse + counts) and the server (CSV filter).
  - `filters`: `{ location?, program?, level?, grade?, payment? }` - AND across groups;
    single value per group. (`status` deferred with engagement.)
  - **Family-level** filters: `location`, `program` (has an active enrollment with that
    programKey), `payment`.
  - **Child-level** filters (BV-scoped): `level` (`bvChildren` some `levelName===level`),
    `grade` (`bvChildren` some `grade===grade`). A family passes iff it has ≥1 BV child
    passing every active child filter.
  - A family is **included** iff it passes all family-level filters AND (no child filter
    active OR has ≥1 passing BV child).
  - `summarizeRoster` returns, over included families:
    - `familyCount`
    - `childCount` - distinct BV children that pass the active child filters (all BV
      children when no child filter is active)
    - `byLevel: Array<{ levelName, childCount }>` - breakdown of those children
    - `byPayment: { paid, outstanding, unknown }` - family counts

### Endpoints

- **New** `GET /api/welcome/roster/report?year=` - welcome-team + admin. Returns the JSON
  dataset projected to **lean client rows** (drops `members`; keeps `bvChildren` sans
  names for level/grade filtering + counts):
  `{ fid, publicFid, legacyFid, name, location, memberCount, payment,
    programs, bvChildren: [{ grade, levelName }] }`. (`bvEngagement` omitted in v1.)
  ~880 rows ≈ 260 KB. Needs an explicit rule in `canAccessRoute` (`/api/welcome/*` is not
  the manager catch-all) - mirror the existing `/api/welcome/families` rule.
- **CSV** stays on the report endpoint: `GET /api/welcome/roster/report?format=csv` +
  the active filters as query params (`location, program, level, grade, payment, year`).
  Server calls the same builder, applies `matchesRosterFilters` server-side, and
  emits one row per person with **two new columns: `level`, `grade`** (grade already
  present; `level` added; both are the BV enrollment's values, blank for non-BV members).
- **Retire** the paginated browse: `/api/welcome/families` (JSON + CSV) and
  `list-families.ts` become unused once the page and export point at the report endpoint.
  Delete them and their tests. `migration-status` route is untouched. `build-csv-rows.ts`
  logic folds into the builder (person rows derived from `members` + BV child level/grade).

### UI (same page shell, mobile + desktop branches preserved)

```
Roster                                          [Export CSV ↓]
Search name / email / phone / FID …

Location:  [All] [Brampton] [Scarborough]
Program:   [All] [Bala Vihar] [Tabla] [Vocal] [Yuva Kendra]
Level:     [All] [Level 1] [Level 2] [Level 3] …      (new; BV levels, from data)
Grade:     [All] [K] [1] [2] [3] …                    (new; from data)
Payment:   [All] [Paid] [Outstanding] [Unknown]       (new)
                        (Status row DEFERRED - not in v1)

┌── matches these filters ──────────────────────────┐
│  42 families · 58 Bala Vihar children             │
│  By level:  L1 · 12   L2 · 18   L3 · 28           │
│  Payment:   Paid 30 · Outstanding 12              │
└───────────────────────────────────────────────────┘

[Rana Family · FID 1075 · Brampton · Paid · 2 members ›]
[Ashwin Family · …]                                    (Load more)
```

- Level and Grade chip options are derived from the loaded dataset (only levels/grades
  that actually occur), sorted naturally (Level 1..N; grades K, 1..12).
- Summary strip recomputes via `summarizeRoster` on every filter change (pure, instant).
- List renders the included families as the existing `RosterFamilyCard`, with a
  client-side "Load more" over the in-memory filtered array (default 50 shown) to keep the
  DOM light in the unfiltered case.
- Filter chips reuse the existing `FilterChip` / `FilterRow` components and layout.
- **Search unchanged** - non-empty search still calls `searchFamiliesClient` and hides
  the filters/summary (as today).
- Loading / error states: one dataset fetch; show a skeleton while loading and a retry
  notice on failure (same tone components as today).

## Data flow

1. Server component (`page.tsx`) resolves `?year=` (unchanged) and renders
   `<RosterBrowser>` with the resolved year.
2. Client `RosterContent` fetches `/api/welcome/roster/report?year=` once on mount.
3. User toggles filter chips → `matchesRosterFilters` + `summarizeRoster` recompute over
   the in-memory dataset → list + summary update instantly.
4. Export → `roster-export-button` GETs `/api/welcome/roster/report?format=csv&<filters>`;
   server rebuilds, filters with the same predicate, streams the CSV.

## Error handling

- The builder never throws per family: a derivation failure for one family yields
  `payment:'unknown'` (same discipline as `deriveFamilyPayment`) so one bad family can't
  blank the report.
- Endpoint returns 401 (no session) / 403 (not welcome-team) / 404 (flag off) like the
  existing roster routes; the client shows a retry notice on non-OK.

## Testing

- **Unit (pure):** `matchesRosterFilters` + `summarizeRoster` with an N≥2 fixture -
  ≥2 families, children across ≥2 levels and ≥2 grades, mixed payment. Assert: each filter
  in isolation, AND-combined filters, `childCount`/`byLevel` reflect matching *children*
  (not families), family included iff ≥1 passing child.
- **Builder:** a fake-firestore test that the bulk join maps enrollment level/grade onto
  `bvChildren` and sums donations into the payment signal (N≥2).
- **CSV:** one row per person incl. adults; `level`/`grade` columns populated for BV kids,
  blank for adults; filters honored.
- **Deployed-UAT E2E** (`e2e/setu/admin/`): sign in as welcome-team, load the report,
  apply a Level filter, assert the family list + the "N children / by level" counts match
  a known UAT fixture. Realistic multi-instance active fixture (per discipline #7).

## Non-goals (v1)

- No saved/named reports, no scheduled exports.
- No cross-link into `/welcome/reports` (that hub keeps its pre-baked aggregate summaries;
  this page is the ad-hoc slice-and-dice + drill-to-family view). They stay complementary.
- Level/Grade filters are **Bala Vihar only** (the report's focus). Other programs remain
  filterable by Program; their per-level breakdown is out of scope until asked.
- **Status (Confirmed/Registered) filter + the engagement chip are deferred** to a
  fast-follow (needs a bulk teacher+door attendance join; door check-ins are a per-family
  read against the shared prod `715b8` check-in Firestore with no bulk path).
- No change to the family/teacher-facing surfaces or the mobile app API.

## Rollout / ops

- Behind the existing `setuAuth` flag + `canAccessRoute` welcome-team gate; no new flag.
- No new Firestore indexes ⇒ no index deploy, no runbook §14 DB entry. The v1 reads are the
  same unfiltered collection / collectionGroup reads `build-csv-rows.ts` already performs
  (families, members, enrollments, donations, offerings) - all index-free. (Any index need
  that surfaces in the UAT walkthrough deploys to **UAT only**, never `--force`, never prod,
  and is recorded in runbook §14.)
- Mobile API changelog: not required (no `/api/setu/*` change; this is a `/api/welcome/*`
  web-only route).
