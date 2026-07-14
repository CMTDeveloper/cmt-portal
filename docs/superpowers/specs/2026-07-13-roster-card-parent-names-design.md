# Roster cards: show parent names instead of the legacy family name - design

**Date:** 2026-07-13
**Status:** Approved
**Scope:** `/welcome/roster` cards only (browse list + search results).

## Problem

Roster cards render `{family.name} Family`. The stored `name` is the messy legacy value
("Rana family", "& Rovita family"), so the card reads "Rana family Family". Vaibhav asked:
replace the family name with the **parents' First Last name** (both parents, joined with
"&", collapsing a shared last name).

## Design

**Pure helper** `formatFamilyParentNames(members, fallback)` in
`packages/shared-domain/src/setu/` (side-effect-free, unit-tested, shared by both
surfaces so the logic lives once):
- Input: the family's members (each `{ firstName, lastName, type, manager }`) + a
  `fallback` string (the stored family name).
- Adults = `members.filter(type === 'Adult')`, ordered **manager-first** (manager:true
  before others; stable otherwise).
- **No adult** -> return `fallback` (never blank).
- **One adult** -> `First Last`.
- **All adults share a last name** -> `First1 & First2 [& First3] LastName`.
- **Mixed last names** -> `First1 Last1 & First2 Last2 [& ...]`.
- Trims/ignores empty names; if every adult name is empty -> `fallback`.

**Two surfaces (no new Firestore reads):**
- **Browse cards** - `report-dataset.ts` already reads every member. Add `manager` to the
  member projection, compute `parentName` via the helper, add it to `RosterReportRow`
  (`parentName: z.string()`), and project it to the lean client row.
- **Search cards** - `searchFamilies` already fetches each family's members for the count.
  Change that read to collect the adult members, compute `parentName` via the helper, and
  add `parentName: string` to `FamilySearchHit` (+ the `/api/setu/family/search` response
  passes it through; `searchFamiliesClient` already returns the whole hit).

**Rendering** (`roster-browser.tsx`): `RosterFamilyCard` and `SearchHitCard` render
`row.parentName` / `hit.parentName` as the title, dropping the `... Family` suffix. The
`FID · Legacy · location` line, program/payment chips, and member count are unchanged.

**Search matching is unchanged** - families are still found by the family name / searchKeys
(typing "Rana" still matches); only the displayed title changes.

## Non-goals
- No change to the family detail page, dashboard, or any other surface (the helper makes
  extending later trivial, but out of scope now).
- No change to how families are searched/matched (display only).
- Status/engagement chip stays deferred (separate work).

## Testing
- **Unit** (helper): one adult; two adults same surname -> "A & B Surname"; two adults
  different surnames -> "A X & B Y"; no adult -> fallback; empty names -> fallback;
  manager ordered first.
- **Builder** test: assert `parentName` computed from the family's adults.
- **Component + deployed-UAT E2E**: a family card shows the parent name; "family Family" no
  longer appears.

## Ops
- No new Firestore indexes, no schema migration (reads existing member fields). No mobile
  API changelog needed unless `/api/setu/family/search` shape counts - it gains an additive
  `parentName` field; record a MOBILE_API_CHANGELOG entry for that route (additive, safe).
