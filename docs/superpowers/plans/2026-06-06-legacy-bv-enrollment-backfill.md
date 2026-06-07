# Legacy Bala Vihar Enrollment Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development for the code tasks (T1, T2). The controller owns the operational run (T3: dry-run → UAT run → verify) since it writes data.

**Goal:** Backfill the ~864 legacy Bala Vihar door-roster families into the portal as **active BV enrollments under the 2025-26 offering**, so the enrollment-gated teacher roster (`deriveRoster`) shows real students matched to their levels by grade. Fix the grade mapper so JK/SK kids match Pre-Level.

**Architecture:** A read-only pass over the prod RTDB `/roster` (864 families, via the existing master bridge) → for each family with a BV center (Brampton / Scarborough / NULL→Brampton): ensure the Setu family+members exist (reuse `lazyMigrateLegacyFamily`, idempotent), re-assert each child's `schoolGrade` (fixes stale/JK-SK), and upsert an **active enrollment doc** for the location's 2025-26 offering — written DIRECTLY (not via `enrollFamily`, which throws in a script via `'use cache'`) and CRUCIALLY carrying **`pid: oid`** (the field `deriveRoster` queries on). All writes target UAT Firestore only; the RTDB read is read-only against prod 715b8.

**Tech Stack:** TypeScript tsx CLI script (`tsx --env-file=.env.local`), Firebase Admin (master RTDB read 715b8 / portal Firestore write UAT), the existing `legacy-parser` + `lazy-migrate` + `resolveSuggestedAmount` helpers, Vitest.

## Confirmed data facts (from a live read-only dump, 2026-06-06)
- 2538 roster rows / 1059 non-parent (grade≠99). Grades: `1`–`12` (~849), `0`+`-1` = JK/SK (155), `-2` = Shishu (36), `14` (19, level NULL).
- Centers: Brampton 1411, **NULL 569**, Scarborough 548, ALL 10. (`mapLocation` already defaults NULL/unknown → Brampton.)
- JK/SK kids carry `level` text "Pre L1 (Gr JK-SK)" (Brampton) / "Pre A (Gr JK-SK)" (Scarborough). Shishu: "Shishu E/W (Pre-K)".
- Offerings `bv-brampton-2025-26` + `bv-scarborough-2025-26` exist (`paymentSource:'legacy'`). Level grade-bands: Pre-Level 1 / Pre A = `['JK','SK']`; Level 1 `['1']`, Level 2 `['2','3']`, … (Brampton) and Level A `['1','2']`, … (Scarborough).

## Decisions (defaults — documented; surface in the summary)
- **JK/SK mapping:** legacy grade `-1` → `"JK"`, grade `0` → `"SK"` (best-guess; the `['JK','SK']` band accepts either, so level-matching is correct regardless; the displayed value is the only thing the guess affects).
- **Shishu (grade `-2`, 36 kids):** NOT matchable — shishu levels are age-based (`birthMonthYear`), and the roster has no birth year (only `dob_m` = month). They'll be enrolled (in `enrolledMids`) but won't appear on a teacher roster until a birth year is set. **Documented limitation.**
- **Grade `14` (19 kids, level NULL):** no band covers it → `schoolGrade` left as-is (won't match a level). Documented.
- **NULL/ALL center (579 rows):** → Brampton offering (matches existing `mapLocation` default). Mississauga/Markham have no 2025-26 offering and don't appear in the data → N/A.
- **Scope:** every roster family with ≥1 non-parent child, enrolled under its center's 2025-26 BV offering.

## Standing constraints
- **UAT writes only.** Refuse to run unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'` (unless `--allow-prod`, never used here). RTDB read of 715b8 is read-only by design. NEVER write 715b8. No new Firestore index (the `enrollments (pid, status)` collection-group index already exists).
- Idempotent: deterministic `eid = ${fid}-${oid}`, `set(..., { merge: true })`, re-runnable.
- Run the FULL `pnpm --filter @cmt/portal lint` before each commit. Never `--no-verify`. Spawn subagents on Opus.

---

## Task T1: fix `mapSchoolGrade` for JK/SK

**Files:**
- Modify: `apps/portal/src/features/setu/registration/legacy-parser.ts`
- Test: `apps/portal/src/features/setu/registration/__tests__/legacy-parser.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test** — add cases asserting JK/SK + numeric mapping. Read the existing test file first; append:

```ts
describe('mapSchoolGrade (JK/SK + numeric)', () => {
  // mapSchoolGrade is module-internal; assert via the public parser output.
  // Use parseLegacyFamily / the exported parse fn the file already tests — match
  // the existing test's invocation. The intent:
  //   grade  3  → schoolGrade "3"
  //   grade  0  → "SK"
  //   grade -1  → "JK"
  //   grade -2  (shishu) → null (no grade match; shishu is age-based)
  //   grade 14  (level "NULL") → null
  it('maps numeric grades 1-12 to the bare number', () => { /* assert a grade-3 child → schoolGrade "3" */ });
  it('maps grade -1 → "JK" and grade 0 → "SK" (Pre-Level band accepts both)', () => { /* ... */ });
  it('leaves shishu (grade -2) and unknown (grade 14, level NULL) as null', () => { /* ... */ });
});
```
(Match the existing test file's actual exported function + fixture style — the snippet is the intent; assert through whatever `legacy-parser.test.ts` already calls.)

- [ ] **Step 2: Run → fail.** `pnpm --filter @cmt/portal exec vitest run src/features/setu/registration/__tests__/legacy-parser.test.ts`

- [ ] **Step 3: Implement.** Replace `mapSchoolGrade` (currently lines ~110-116) with:

```ts
// Legacy `grade` is numeric: 1-12 are real grades; 0 and -1 are the JK/SK
// pre-level kids (level text "Pre L1 (Gr JK-SK)"); -2 is shishu (Pre-K,
// age-based — no grade); 99 is a parent; 13+/14 are alumni/edge (no band).
// Map to a `schoolGrade` that `normalizeGrade` + the level gradeBands can match.
function mapSchoolGrade(row: LegacyRosterRow): string | null {
  const g = Number(row.grade);
  if (Number.isFinite(g)) {
    if (g >= 1 && g <= 12) return String(g);
    if (g === -1) return 'JK'; // Pre-Level band is ['JK','SK'] — both match
    if (g === 0) return 'SK';
    // -2 (shishu, age-based), 13+/14 (no band): no usable school grade
    return null;
  }
  // Non-numeric grade (rare) — fall back to the free-text level if it looks
  // like a real grade; otherwise null (don't store the raw "Pre L1 (...)" blob).
  const lvl = clean(row.level);
  return lvl && /^(jk|sk|\d{1,2})$/i.test(lvl) ? lvl : null;
}
```

- [ ] **Step 4: Run → pass.** Same command. Then `pnpm --filter @cmt/portal lint` + `pnpm --filter @cmt/portal exec tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add apps/portal/src/features/setu/registration/legacy-parser.ts apps/portal/src/features/setu/registration/__tests__/legacy-parser.test.ts
git commit -m "fix(legacy): map JK/SK (grade 0/-1) + drop garbage pre-level grade blobs (backfill)"
```

---

## Task T2: the backfill script

**Files:**
- Create: `apps/portal/scripts/backfill-bv-enrollments.ts`
- Modify: `apps/portal/package.json` — add alias `"backfill:bv-enrollments": "tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts"`

- [ ] **Step 1: Read the reuse points** (so the doc is schema-valid + uses real helpers):
  - `apps/portal/src/features/setu/registration/lazy-migrate.ts` — `lazyMigrateLegacyFamily(legacyFid)`.
  - `apps/portal/src/features/setu/registration/legacy-parser.ts` — the parse fn that returns a family's children with `schoolGrade`/`legacySid` (reuse to re-assert grades + find BV children).
  - `apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts` — `listAllFamilies()` (the legacy fids + centers).
  - `packages/shared-domain/src/setu/schemas/enrollment.ts` — the EXACT `EnrollmentDoc` fields + the `enrolledVia` enum (`'family-initiated'|'first-attendance'|'welcome-team'`). Use `'welcome-team'`.
  - `apps/portal/src/features/setu/enrollment/...` — `resolveSuggestedAmount(offering, refDate)` (for `suggestedAmountSnapshot`).
  - `apps/portal/scripts/seed-e2e-family.ts` `ensureEnrollment()` — the direct-write pattern to mirror (BUT it OMITS `pid` — you MUST add it).
  - `apps/portal/scripts/migrate-legacy-families.ts` — the UAT guard + bulk loop + CLI flags to mirror.

- [ ] **Step 2: Implement `backfill-bv-enrollments.ts`.** Behaviour:
  1. **Guard:** refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'` (unless `--allow-prod`). Flags: `--dry-run`, `--limit N`, `--fid X`, `--allow-prod`.
  2. **Load offerings once:** read `offerings/bv-brampton-2025-26` + `offerings/bv-scarborough-2025-26` from portal Firestore. Build `oidForCenter(center)`: `'Scarborough' → bv-scarborough-2025-26`; everything else (Brampton/NULL/ALL/missing) → `bv-brampton-2025-26`.
  3. **For each legacy family** (from `listAllFamilies()`, honoring `--limit`/`--fid`):
     a. `await lazyMigrateLegacyFamily(legacyFid)` (idempotent — ensures `families/{fid}` + members + contactKeys).
     b. Resolve the Setu `fid` (the migrate result returns it, or look up `families where legacyFid == legacyFid`).
     c. Re-parse the legacy family → its non-parent children with `{ legacySid, schoolGrade }` (via the parser; schoolGrade now JK/SK-correct from T1).
     d. Read the Setu family's members; map `legacySid → mid`. For each child member whose stored `schoolGrade` differs from the freshly-parsed value, **upsert** `schoolGrade` (`set(members/{mid}, { schoolGrade }, { merge:true })`) — fixes already-migrated stale grades.
     e. `enrolledMids` = the Setu child mids (type `'Child'`).
     f. Pick `oid = oidForCenter(center)`, load that offering doc, derive `location`/`programLabel`/`termLabel`. Compute `suggestedAmountSnapshot = resolveSuggestedAmount(offering, offering.startDate)`.
     g. **Upsert the enrollment** `families/{fid}/enrollments/{fid}-{oid}` with `set(..., { merge:true })`:
        ```ts
        {
          eid: `${fid}-${oid}`, fid, oid,
          pid: oid,                       // ★ REQUIRED — deriveRoster queries where('pid'==level.pid)
          programKey: 'bala-vihar', programLabel, termLabel, location,
          enrolledMids,
          enrolledAt: FieldValue.serverTimestamp(),
          enrolledVia: 'welcome-team', enrolledByMid: <family manager mid>,
          suggestedAmountSnapshot, suggestedAmountOverride: null,
          status: 'active', cancelledAt: null, cancelledReason: null,
        }
        ```
        (Confirm against `EnrollmentDoc` schema; include every required field. `enrolledByMid` = the family's first manager mid — every migrated family has a `${fid}-01` manager.)
     h. In `--dry-run`: log the family fid, center→oid, child count, enrolledMids, and grade fixes — write nothing.
  4. **Summary:** families processed / enrolled / skipped (no children) / per-center counts / grade-fixes applied / errors. Mirror `migrate-legacy-families.ts`'s summary style.
  - Tolerate per-family errors (log + continue); never throw the whole run.

- [ ] **Step 3: Typecheck the script.** `pnpm --filter @cmt/portal exec tsc --noEmit` (note: `scripts/**` may be outside the package tsconfig `include` — if so, run an isolated `tsc --noEmit` on the file to get real type coverage, like the door-access probe did). Lint: `pnpm --filter @cmt/portal lint`.

- [ ] **Step 4: Commit.**
```bash
git add apps/portal/scripts/backfill-bv-enrollments.ts apps/portal/package.json
git commit -m "feat(scripts): legacy BV enrollment backfill (UAT, idempotent, pid-correct) (backfill)"
```

---

## Task T3 (controller-owned): run + verify
1. **Dry-run a sample:** `pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --dry-run --limit 20` — sanity-check center→oid mapping, child counts, grade fixes.
2. **Full UAT run:** `pnpm --filter @cmt/portal backfill:bv-enrollments` (no flags → UAT, all families; ~864, several minutes).
3. **Verify:** `pnpm --filter @cmt/portal check:migrations` (enrollment counts up); spot-check a level populates — e.g. a quick read-only count of `deriveRoster('brampton-level-1-bv-brampton-2025-26', <a Sunday>)` members, or just reload the teacher screen for Level 1 / Pre-Level 1. Confirm JK/SK kids now appear in Pre-Level.

---

## Self-review (controller)
- **`pid: oid` on every enrollment doc** — the one silent-failure trap; without it the roster stays empty. Called out in T2.2.g. ✓
- **JK/SK fix** (T1) so Pre-Level populates; shishu + grade-14 documented as not-shown. ✓
- **Idempotent + UAT-guarded + dry-run** (mirrors migrate-legacy-families). ✓
- **No new index; read-only 715b8; UAT writes only.** ✓
- enrolledMids doesn't affect the roster (deriveRoster grade-matches all members) but is set correctly for the dashboard/donation surfaces. ✓

## Known follow-ups (not this slice)
- **School-year promotion / rollover** (CMT Developer's stated next need): promote existing kids to the 2026-27 offering + enroll new students — a dedicated mechanism (bump grade, new enrollment under `bv-*-2026-27`, archive 2025-26). Separate spec.
- Shishu kids: to show them, backfill `birthMonthYear` (needs a birth YEAR, not just `dob_m` month — not in the roster; would need another source).
- Once families self-manage in Setu, the backfill becomes a one-time seed; new families enroll organically.
