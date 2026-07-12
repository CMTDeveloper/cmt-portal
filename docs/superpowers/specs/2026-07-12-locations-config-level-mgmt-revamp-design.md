# Admin-managed locations + Level Management revamp — Design

**Date:** 2026-07-12
**Status:** Approved (design) — pending spec review before planning
**Owner:** CMT Developer

## Goal

Two connected pieces:

1. **Locations become admin-managed config.** Today the set of centers is a hardcoded `LOCATIONS` enum baked into ~7 shared-domain schemas. Reduce the going-forward default to **Brampton + Scarborough** and make the list **editable by admins** (add / remove-unused / reorder) with no code deploy — following the same evolution `programKey` already took (frozen enum → dynamic slug validated at write time).
2. **Level Management page redesign.** Reshape `/admin/levels` into the master-detail layout from the 2026-07-12 mockup: a sticky filter bar with an always-one-selected Location toggle, three stat cards, a levels list on the left, and a right-hand panel to manage a selected level's teachers (search → add, pills with remove, one Lead among many).

## Background / current state

- Canonical constant: `packages/shared-domain/src/setu/schemas/offering.ts:12`
  `export const LOCATIONS = ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const;`
- Cascades via `z.enum(LOCATIONS)` into schemas: `offering`, `enrollment`, `level`, `program`, `class-calendar`, `roster`; and drives admin dropdowns (`program-form`, `offerings-panel`, `programs-table`, `admin/calendar/page`, welcome `roster-browser`) and API validators (`admin/calendar`, `admin/calendar/weekly`, `setu/calendar`).
- Inline copies **not** using the constant: `schemas/family.ts:55` (`FamilyDocSchema.location`, read-validated), `app/register/family/page.tsx` (type + two pill arrays), `api/setu/register/route.ts:40`, `features/setu/registration/register-family.ts:7` (duplicate `Location` type), `features/setu/registration/legacy-parser.ts:25` (`VALID_LOCATIONS`).
- **Real UAT data (verified read-only, 2026-07-12):** 881 families → Brampton 714, Scarborough 167. **Zero** Markham, zero Mississauga, zero blank. So narrowing the default set breaks no existing reads.
- Bala Vihar already runs at only 2 centers operationally: `rollover/school-year.ts` hardcodes `BV_LOCATIONS = ['brampton','scarborough']`; prasad periods and rollover only cover those two.
- Existing app-managed-config precedent: `app_config/{volunteering_skills,disclaimers,seva_requirement}` + school-year config, each with an `/admin/*` editor. `apps/portal/src/lib/volunteering-skills.ts` is the closest template (admin-editable list of strings with a `DEFAULT_*` fallback).

## Approach decision

**Dynamic, config-driven locations** (chosen over a display-only reorder of a fixed enum). Locations become a first-class admin-managed list; schemas relax from `z.enum` to `z.string`, and "is this a real center?" is enforced at **write** time against the config — exactly how `programKey` works. This honors "admins can add a genuinely new center (e.g. Oakville) without a deploy." Locations remain **plain display strings** (the name *is* the key), so there is **no data migration** of the denormalized `location` field.

---

## Part A — Locations as config (foundation)

### A1. Storage + accessors

New `apps/portal/src/lib/locations.ts` (mirrors `lib/volunteering-skills.ts`):

- `DEFAULT_LOCATIONS: readonly string[] = ['Brampton', 'Scarborough']`
- `getLocationOptions(): Promise<string[]>` — reads `app_config/locations.options`; falls back to `DEFAULT_LOCATIONS` when the doc is **absent** (no lazy write, so the read path needs no write permission). Otherwise returns exactly what is stored. Unlike volunteering-skills, an empty list is invalid — but that invariant is enforced at the **writer** (the PUT route refuses to save an empty list, since at least one center must always exist), so the reader never observes an empty stored array.
- `setLocationOptions(options: string[]): Promise<void>` — overwrites `{ options, updatedAt: serverTimestamp() }`. Caller (the PUT route) trims/dedupes/validates first.

Config doc: `app_config/locations` → `{ options: string[], updatedAt: Timestamp }`. Auto-creates on first admin Save; no seed script required.

### A2. Schema relaxation

- `offering.ts`: reduce `LOCATIONS` to `['Brampton', 'Scarborough'] as const` (now the **default/seed** list, no longer the closed universe) and change `export type Location = string`.
- In `offering`, `enrollment`, `level`, `program`, `class-calendar`, `roster`, and `family` schemas: `z.enum(LOCATIONS)` → `z.string().min(1)` (preserving `.nullable()` / `.array()` wrappers where present). Read schemas no longer reject an admin-added center.
- `FamilyDocSchema.location` (family.ts) switches from its inline enum to `z.string().min(1)`.
- Delete the duplicate `Location` type in `features/setu/registration/register-family.ts` and the local `type Location` in `register/family/page.tsx`; both use `string` / the shared `Location`.

### A3. Dropdowns + validators read config

- **Server-rendered** dropdown sources (`admin/calendar/page`, program/offering/level admin surfaces, welcome `roster-browser`) render `await getLocationOptions()` instead of mapping the constant. Where a component is client-side, its server parent passes `locationOptions` as a prop.
- **API validators** that currently do `LOCATIONS.includes(x)` (`admin/calendar`, `admin/calendar/weekly`, `setu/calendar`) validate against `getLocationOptions()`.

### A4. Write-time membership validation

The submitted location must be a known center at every write that persists one:

- `POST /api/setu/register` — `location` becomes `z.string().min(1)`, then handler rejects (`invalid-location`) if `!(await getLocationOptions()).includes(location)`. A family can only pick from the admin-managed set; nothing arbitrary is written.
- Admin offering create/update and level create — location comes from the offering's period, which is itself constrained to the config set; add the same membership check defensively.

### A5. Public locations endpoint

New `GET /api/setu/locations` → `{ options: string[] }`, backed by `getLocationOptions()`. Consumed by the **unauthenticated** registration client and by future mobile (so neither hardcodes the center list).

- **Public** route: add to BOTH `public-routes.ts` (the `isPublicRoute` gate runs first) AND `canAccessRoute` (open to any/anon), per the "public route needs both lists" rule.
- Register client (`register/family/page.tsx`) fetches this on mount to render the location pills; falls back to `DEFAULT_LOCATIONS` on fetch failure so registration never blocks.

### A6. Legacy parser (unchanged behavior)

Family location continues to come from the roster `center` field **verbatim** (identity mapping — no geographic remap), per owner decision. `legacy-parser.ts` keeps recognizing the historical center strings so it reads legacy data faithfully; its output type widens to `string` with the `Location` change. Because real legacy centers are only Brampton/Scarborough, no stored family lands outside the config set.

---

## Part B — `/admin/locations` editor

A near-clone of `/admin/volunteering-skills`.

- **Page** `app/admin/locations/page.tsx` (admin-only): lists current centers with **add**, **reorder**, **remove**. Reachable from the grouped `/admin` dashboard ("People & access" / config group) and the admin sidebar.
- **API** `PUT /api/admin/locations` (admin-only; add the `canAccessRoute` rule): trims, dedupes (case-insensitive), rejects an empty resulting list (at least one center must exist), writes via `setLocationOptions`.
- **Referential-safety guard on remove:** a center may be removed only if **no** `families`, `offerings`, `levels`, or `enrollments` doc references it. Each check is a single-field `where('location','==',X).limit(1)` (auto-indexed). If any exist, the PUT refuses with a count-bearing message, e.g. `"714 families are at Brampton — reassign them before removing it."` The guard runs server-side in the route for every center present in the *old* list but absent from the *new* one.

### Non-goals for this editor (deferred)

- **Rename with cascade.** Because the name is the denormalized key, renaming a referenced center would orphan its docs unless every referencing doc is rewritten. v1 supports add / remove-unused / reorder only. (Typos on a brand-new, unreferenced center are fixed by remove + add.) A cascading rename is a later enhancement if wanted.
- **Slug + label model.** Not adopted — it would require migrating all stored `location` strings. Revisit only if label editing becomes a hard requirement.

---

## Part C — Level Management redesign

Reshape the existing `/admin/levels` experience (server data loads in `app/admin/levels/page.tsx` stay; the change is in `features/admin/levels/`).

### C1. Layout

- **Sticky filter bar:** Academic Year (existing switcher) · **Location** · Program (existing selector) · search box · "Show disabled" toggle.
  - The **Location filter is a segmented toggle that is always exactly one center** — there is no "All" option (owner requirement: a focused single-center list). Rendered from `getLocationOptions()`, defaulting to the first center. Selecting a center filters the list to that center's levels.
- **Three stat cards** derived from the current filtered list: Total levels · Levels with teachers · Levels needing teachers.
- **Left — levels list:** rows for the selected year/location/program. Clicking a row selects and highlights it. Each row keeps its existing **Edit** control (the level-fields modal: name, kind, grades, curriculum, enable/disable) and enable/disable toggle.
- **Right — detail panel** for the selected level: its grades / curriculum / status, plus **teacher management** (moved out of the current per-row popover): search teachers → add, teacher pills with remove, and Lead designation (C2). `Save changes` / `Cancel`. When no row is selected, the panel shows an empty/prompt state.

### C2. Teachers — many per level, one optional Lead

- A level has **N teachers** (`teacherRefs: string[]`, unchanged) — multiple teachers per class is a first-class case.
- Add `leadTeacherRef: z.string().nullable().optional()` to `LevelDoc` (`schemas/level.ts`). At most one Lead; every other teacher renders as **Assistant**.
- **Guards:**
  - `leadTeacherRef`, when set, must be one of the level's `teacherRefs` (enforced at the write route).
  - Removing the teacher who is the Lead clears `leadTeacherRef` (server-side, atomically with the removal).
- Existing teacher add/remove endpoints under `/api/admin/levels/[levelId]` stay; extend the level PATCH to set/clear `leadTeacherRef`. Client helpers live alongside `assign-teacher-client.ts`.
- Backward-compatible: existing levels have no `leadTeacherRef` (null) → all their teachers render as Assistant until an admin marks a Lead.

### C3. Component shape

- The current `levels-table.tsx` (table + inline teacher popover + edit modal) is refactored: the table/list + row selection + stat cards + filter bar form the master view; the teacher popover's logic moves into the right panel component. Keep files focused — a `LevelsMasterList`, a `LevelDetailPanel`, and the retained `LevelModal` (edit) rather than one oversized file.
- Mobile: the master-detail collapses to list → tap → panel (or a stacked card view), consistent with the existing responsive pattern in the levels table.

---

## Data model summary

| Doc / type | Change |
|---|---|
| `app_config/locations` | **New** `{ options: string[], updatedAt }` |
| `LOCATIONS` (offering.ts) | Reduced to `['Brampton','Scarborough']` (default/seed, not closed set) |
| `type Location` | `= string` |
| `z.enum(LOCATIONS)` in 7 schemas | → `z.string().min(1)` (wrappers preserved) |
| `LevelDoc.leadTeacherRef` | **New** `z.string().nullable().optional()` |

No migration of existing `location` values (they remain valid strings). No new composite Firestore indexes expected (referential checks are single-field equality; the levels page's `(location, order)` index already exists) — audited during planning.

## Testing strategy

- **Unit:**
  - `locations.ts`: default fallback when doc absent; returns stored options when present.
  - `PUT /api/admin/locations`: trim/dedupe; refuse empty list; referential-guard refuses removing a referenced center; allows removing an unused one; add + reorder.
  - Schema relaxation: `z.string()` accepts a config-added center that the old enum rejected.
  - Write membership validation: `/api/setu/register` rejects a location not in config.
  - `LevelDoc.leadTeacherRef`: schema accepts null/omitted/valid; write route rejects a lead not in `teacherRefs`; removing the lead teacher clears the field.
- **Deployed-UAT E2E** (mandatory — every user-facing route; realistic multi-instance fixture, ACTIVE state, run vs `cmt-setu.vercel.app`, password sign-in, self-cleaning):
  1. `/admin/locations`: add "Oakville" → appears in a location dropdown; remove-unused "Oakville" succeeds; removing a referenced center (Brampton) is refused with the count message.
  2. `/admin/levels` redesign: location toggle switches the list between the two centers; click a row → detail panel opens; add a teacher, remove a teacher, mark a Lead (badge shows), with ≥2 levels and ≥2 teachers in the fixture at both centers.
- **Index audit** per the `auditing-firestore-indexes` skill during planning; expectation is no new composite indexes.

## Rollout / bookkeeping

- **MOBILE_API_CHANGELOG** (required — `/api/setu/**` shape change): `/api/setu/register` `location` enum → `string`; **new** `GET /api/setu/locations` returning `{ options }` — mobile should fetch the center list instead of hardcoding four.
- **Runbook §14 (2026-07-12):** `app_config/locations` lazy-defaults to Brampton + Scarborough (no seed). Record the going-forward reduction from four centers to two, and the standing pre-prod check: before shipping to prod, run the read-only location distribution to confirm no family/offering/level references a center outside the config set (UAT confirmed clean 2026-07-12).
- **UAT-only.** No prod DB writes. Config doc auto-creates on first admin Save in UAT. Never `--force` an index deploy.

## Decomposition (execution order)

1. **Slice 1 — Foundation:** `locations.ts`; schema relaxation + `type Location`; dropdowns/validators read config; write membership validation; `GET /api/setu/locations` (+ public-route wiring); `/admin/locations` page + `PUT` route with referential guard; register client fetch. MOBILE_API_CHANGELOG + runbook entries.
2. **Slice 2 — Redesign:** `LevelDoc.leadTeacherRef` + write route + client; Level Management master-detail (filter bar with always-one Location, stat cards, list, right teacher panel with Lead). Deployed-UAT E2E.

## Risks / mitigations

- **Losing compile-time `Location` union.** Accepted — mirrors the `programKey` trade already made; write-time validation replaces enum enforcement. Membership checks must be present at every location-persisting write (enumerated in A4/C2).
- **A center removed while still referenced.** Prevented by the referential-safety guard (Part B); the guard checks all four referencing collections.
- **Client register page can't read server config.** Solved via `GET /api/setu/locations` with a `DEFAULT_LOCATIONS` client fallback.
- **Stale `use cache` after an admin edits locations.** The admin editor and dropdowns should read fresh (revalidate the relevant tag on Save) so a newly added center appears without a stale-cache bounce.
