# Legacy family enrollment backfill (current school year) - design

**Date:** 2026-07-13
**Status:** Approved - revised 2026-07-13 to reuse + generalize the existing
`backfill-bv-enrollments.ts` (instead of a new `enrollFamily`-based script).
**Author:** CMT Developer (with Claude)

## Problem

Teacher attendance rosters (and the "Previous students" secondary list) only show
children whose family has an **active Bala Vihar enrollment** for the **current
school year's** offering. A read-only UAT audit (2026-07-13) found **145 families
that have >=1 Child member but no active enrollment at all** - 142 of them legacy
families migrated from the old check-in roster (Brampton-heavy), 3 non-legacy.
Their children appear on **no** teacher roster, not even Previous students.

Concrete case: Harshita Rana (Grade 2, Brampton), family `CMT-AI55HB3E`
(`legacyFid 477`), has zero enrollments, so she is invisible to the Level 2
teacher.

Root cause: the existing `apps/portal/scripts/backfill-bv-enrollments.ts` enrolled
legacy families into the **2025-26** offerings; the school-year rollover
(`promoteFamilies`) then promoted the families that had a 2025-26 enrollment into
**2026-27**. Families that were never enrolled in 2025-26 (or were enrolled after
the rollover ran) never received a 2026-27 enrollment. The roster code is correct -
it requires an active current-year enrollment (the `enrolledMids` gate drops
**0** grade-band matches among already-enrolled families).

## Goal

Ensure every currently-registered legacy family has an **active current-school-year
Bala Vihar enrollment**, so their children surface on the teacher roster. The
enrollment is created **unconfirmed** (`enrolledVia: 'welcome-team'`), so the kids
land in each level's **Previous students** list; a teacher marking one present
confirms the family (issue-#23 `isEnrollmentConfirmed` via `attendedCount > 0`) and
moves the whole family to Enrolled - exactly the Enrolled-vs-Previous flow shipped
this week.

## Non-goals

- **No grade advancement.** These families were never promoted; the RTDB roster's
  grade is their current grade (Harshita = Grade 2). Grades are re-asserted from
  the authoritative legacy roster, not advanced.
- **No fixing of genuinely-missing grades.** A currently-registered child with no
  parseable grade will enroll but still not match a level. The report surfaces
  these; correcting them is a separate data task.
- **No schema change, no new `enrolledVia` value, no new Firestore index.**
- **No auto-confirmation.** Backfilled families stay in Previous students until a
  teacher marks one present, or the family attends/donates. (A legacy-*paid*
  family is confirmed by the existing issue-#23 rule and lands directly in
  Enrolled - consistent, not a regression.)
- **The 3 non-legacy no-enrollment families are out of scope** (portal-registered,
  chose not to enroll). The script reads the legacy roster, so they're naturally
  excluded.

## Mechanism: generalize `backfill-bv-enrollments.ts`

Reuse the existing, authoritative, idempotent script rather than build a new one.
It already: reads the prod legacy roster (`MASTER_FIREBASE`, read-only) via
`listAllFamilies()`; `lazyMigrateLegacyFamily(legacyFid)` to ensure the Setu
family + members exist; re-parses each family (`fetchLegacyFamilyForMigration`) to
get **currently-registered** children (non-null legacy `level`) with
JK/SK-corrected grades; sets `enrolledMids` to the current children's Setu mids;
and upserts a schema-valid enrollment doc **including `pid`** (the field
`deriveRoster` queries on). It is UAT-guarded (`--allow-prod` to bypass) and
idempotent (`eid = {fid}-{oid}`, `set(..., { merge:true })`).

Three changes:

### 1. Target the current school year (not hardcoded 2025-26)

Replace the hardcoded `BV_BRAMPTON_OID = 'bv-brampton-2025-26'` /
`BV_SCARBOROUGH_OID = 'bv-scarborough-2025-26'` constants with offering ids derived
from the **live school year**, read (non-cached, script-safe) via
`getSchoolYearConfig(portalFirestore()).currentYear` (e.g. `"2026-27"`):
`bv-brampton-<year>` / `bv-scarborough-<year>`. The script already loads each
offering and refuses to run if one is missing (`Seed offerings first`), so a wrong
/ unseeded year fails fast rather than writing garbage.

### 2. Skip families that already have an active current-year enrollment (safety-critical)

Before any grade re-assert or enrollment write, if the family already has an
**active enrollment for the target current-year `oid`** (`eid = {fid}-{oid}`,
`status == 'active'`), **skip the family entirely** and count it as
`skipped-already-enrolled`.

This protects the ~513 families the rollover already promoted: the rollover
**advanced their grades** (grade 1 -> 2, etc.), which the legacy roster does not
know about. Without this guard, the script's grade re-assert would **revert** those
advances and overwrite good `enrolledVia`/`levelSnapshots`. With it, the script
touches **only** families missing a current-year enrollment (~142) and never the
513.

### 3. Keep one active BV enrollment per family

For a family we *do* enroll, cancel any **other** active BV enrollment whose `oid`
differs from the current-year one (a stale prior-year enrollment), mirroring the
rollover's cancel-source behavior, so the family ends with exactly one active BV
enrollment. For the ~142 target families this is a no-op (they have zero active
enrollments); it only matters for the rare family holding a stale prior-year active
enrollment with no current-year one. (`selectBalaViharEnrollment` and other
"active BV enrollment" readers stay unambiguous.)

`enrolledVia` stays `'welcome-team'` (unchanged) - unconfirmed under the issue-#23
rule, so the kids land in Previous students, exactly like the rollover
carry-forwards already there. No enum / Zod / mobile-contract change.

## Data source & the RTDB read

`listAllFamilies()` / `fetchLegacyFamilyForMigration()` read the legacy roster
through `readRtdb()`, which honors `RTDB_SNAPSHOT_DIR=.rtdb-snapshot` - so the
**UAT run reads the local snapshot**, not live RTDB (respects the no-live-RTDB
rule). The **prod cutover run** reads live prod `715b8` RTDB **read-only** via
`MASTER_FIREBASE` (acceptable for a one-off migration; the script never writes
715b8). Refresh the snapshot (`pnpm --filter @cmt/portal snapshot:rtdb`) before the
UAT run if it's stale.

## Script interface (existing flags, unchanged)

`apps/portal/scripts/backfill-bv-enrollments.ts`, run via the existing
`backfill:bv-enrollments` pnpm alias (`tsx --env-file=.env.local`):
- `--dry-run` - compute the plan, write nothing, print the full report.
- `--limit <N>` / `--fid <legacyFid>` - staged validation.
- `--allow-prod` - required when `PORTAL_FIREBASE_PROJECT_ID != 'chinmaya-setu-uat'`.

## Output report (extend the existing summary)

Keep the current counts (processed / enrolled / deactivated / skipped-no-current /
skipped-no-kids / grade-fixes / per-offering) and add:
- **`skipped-already-enrolled`** - families skipped by the new guard (expected
  ~513 on UAT).
- **`prior-year-cancelled`** - stale prior-year enrollments cancelled by change 3.
- **Enrolled-but-gradeless children** - explicit list (`name, mid, legacyFid`) of
  enrolled current children with no `schoolGrade`, so a silent "enrolled but on no
  level" gap is visible for follow-up.

## Idempotency & re-run

Re-running is safe: the guard skips already-active current-year families, so a
second run enrolls **0** new families and writes nothing. A killed run resumes
cleanly.

## Verification

1. **Dry-run on UAT** (`--dry-run`): expect ~142 would-enroll (Brampton-heavy),
   ~513 skipped-already-enrolled, the rest skipped-no-current-children (graduated).
2. **Staged commit on UAT**: `--fid 477` first (Harshita's family), inspect, then
   the full run.
3. **Post-commit re-audit** (read-only): "children but no active enrollment" for
   legacy families drops to ~0.
4. **Idempotency**: immediate re-run reports 0 enrolled, ~all skipped.
5. **Deployed-UAT walkthrough**: Harshita appears in Level 2 -> **Previous
   students**; a teacher marking her present moves the Rana family to **Enrolled**
   and records one present attendance event.
6. **Regression guard**: spot-check 2-3 already-promoted (grade-advanced) families
   before/after - grades and enrollment unchanged (proves the skip-guard holds).

## Runbook & docs (required, same change)

- §6 (prod data-migration sequence): add the current-year re-run of
  `backfill:bv-enrollments` as a cutover step, after the year is activated and BV
  offerings are seeded, before kiosk cutover.
- §10 (CLI script reference): note the script now targets the **live** school year
  (no longer hardcoded 2025-26) and gained the already-enrolled skip-guard.
- §14: dated entry describing the generalization + the UAT run + the prod
  `--allow-prod` cutover TODO.
- §3/§5 unchanged (no new collection/field/index).
- No `MOBILE_API_CHANGELOG.md` entry (no `/api/setu/*` shape change).

## Files

- Modify: `apps/portal/scripts/backfill-bv-enrollments.ts` - current-year offering
  resolution (change 1), already-enrolled skip-guard (change 2), prior-year cancel
  (change 3), extended report.
- Optional: extract `currentYearBvOids(year)` and the "already active current-year
  enrollment?" decision into small pure helpers so they can be unit-tested; the
  end-to-end behavior is verified by the UAT dry-run + idempotency re-run (the
  established pattern for this ops script, which has no unit tests today).
- Modify: `docs/runbooks/production-cutover-checklist.md` (§6, §10, §14).
