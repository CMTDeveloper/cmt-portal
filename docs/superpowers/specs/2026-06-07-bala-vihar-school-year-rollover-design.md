# Bala Vihar School-Year Rollover (2025-26 → 2026-27) — Design Spec

> **Date:** 2026-06-07 · **Author:** brainstorming session with CMT Developer
> **Status:** Approved design — ready for implementation plan (writing-plans).
> **Scope:** Admin-driven, one-click promotion of every Bala Vihar (BV) child to the next school year, with full per-child history preserved. Plus a "Start new year" step that clones the year's levels/offerings.

---

## 1. Goal (one sentence)

Give admins two guided actions — **Start 2026-27** (clone this year's levels + offerings) and **Promote families** (advance every child one grade, re-derive their level, close the old year, keep the history) — so the entire roster moves to the new school year in one click without losing any child's journey.

## 2. Why this exists / problem

When we cut over to production, every enrolled child sits in their **2025-26** grade/level. Real school years advance: a Grade 1 child in *Level 1* this year is Grade 2 next year, and in Bala Vihar that may mean *Level 2* — **but levels span two grades** (Brampton Level 2 = Gr 2 **&** 3; Level 3 = Gr 4 & 5; Scarborough Level A = Gr 1 & 2; etc.). So promotion is **grade-driven, never level-driven**: we advance the child's grade and let the level fall out of the grade band. There is no existing mechanism for this, and doing it by hand across ~500 families is error-prone.

## 3. The central data fact (why the two-grades-per-level case "just works")

A child has **no stored level** — only a stored `schoolGrade` (free-text string, nullable). The BV level is *always derived* at read time by `memberMatchesLevel(member, level, now)` matching `normalizeGrade(member.schoolGrade)` against each level's `gradeBand` array (`packages/shared-domain/src/setu/schemas/level.ts:129`). Therefore:

| Child (Brampton) | This year | Advance grade | Next year (re-derived) |
| --- | --- | --- | --- |
| Gr 2 | Level 2 (Gr 2&3) | → Gr 3 | **Level 2** (still in band) ✓ |
| Gr 3 | Level 2 (Gr 2&3) | → Gr 4 | **Level 3** (Gr 4&5) ✓ |
| Gr 1 | Level 1 (Gr 1) | → Gr 2 | **Level 2** ✓ |
| JK | Pre-Level 1 (JK/SK) | → SK | **Pre-Level 1** (still JK/SK) ✓ |

We only ever mutate the **grade**; the level is recomputed against the **target year's** levels at the **child's location** (bands differ per location and are admin-editable data — never hardcoded).

## 4. Decisions (locked in brainstorming)

1. **History-preserving close.** Advance the child's live `schoolGrade` (so the child profile immediately shows the new grade/level), **and** snapshot the year-they-just-finished onto the now-closed 2025-26 enrollment. A child's "journey" = their enrollments across years, each carrying that year's grade + level. **No new collection** (discipline 6) — snapshots live on the existing enrollment doc.
2. **Clone to start the year.** A "Start 2026-27" step clones each location's 2025-26 levels (grade bands, curriculum, order, age labels) to new 2026-27 levels with **empty teacher assignments**, and ensures the 2026-27 offerings exist.
3. **One-click automatic.** No per-kid review screen. The only gate is a **dry-run preview + a single confirm** ("Promote 480 students…"), because this is a once-a-year, hundreds-of-children, irreversible-in-one-click mutation.
4. **Graduation.** A child on the top rung (Gr 12) **completes the program**: their 2025-26 enrollment is closed with a snapshot, **no** 2026-27 enrollment is created, and their grade is left as-is so they cleanly drop off all rosters. History kept.
5. **Child-profile history strip** ships now (cheap, shows the value). The richer "journey timeline" visualization is deferred.
6. **No structured `schoolYear` field** — keep using `termLabel` / `periodLabel` ("2025-26") and the deterministic oids/pids as the year key. The admin picks from-year → to-year (defaults 2025-26 → 2026-27).

## 5. The grade ladder (the crux, precisely)

A single ordered ladder, in `packages/shared-domain/src/setu/grade-ladder.ts` (pure TS, web+mobile reusable, no React):

```ts
// Ordered rungs. JK and SK precede Grade 1; Grade 12 is terminal.
export const GRADE_LADDER = ['JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

export type PromotionOutcome =
  | { kind: 'advance'; from: string; to: string }      // normal: next rung
  | { kind: 'graduate'; from: '12' }                   // top rung → completes program
  | { kind: 'shishu-stays' }                            // age-based, no grade — re-enroll unchanged
  | { kind: 'shishu-aged-out' }                         // ≥60 months, still no grade — NEEDS ATTENTION (assign JK/SK)
  | { kind: 'needs-grade' };                            // not shishu, grade missing/unreadable — NEEDS ATTENTION

/**
 * Decide a child's promotion outcome from their current member fields.
 * - schoolGrade present & on the ladder → advance one rung, or graduate at '12'.
 * - schoolGrade present but NOT on the ladder (e.g. "Kindergarten", "13") → needs-grade.
 * - schoolGrade null & shishu-age (18–59 months) → shishu-stays.
 * - schoolGrade null & age ≥ 60 months (or no birthMonthYear) → shishu-aged-out / needs-grade.
 */
export function decidePromotion(
  member: { schoolGrade: string | null; birthMonthYear: string | null },
  now: Date,
): PromotionOutcome;
```

`decidePromotion` normalizes via the existing `normalizeGrade` so `"Grade 3"`, `"Gr 3"`, `"3"` all resolve to `"3"`. JK/SK are matched case-insensitively to the `'JK'`/`'SK'` rungs. The function is the single source of truth; both the engine and the dry-run preview use it.

**Edge-case table:**

| Situation | Outcome | Effect |
| --- | --- | --- |
| Gr 1–11 | `advance` | grade +1 rung, re-enrolled, level re-derived |
| JK / SK | `advance` | JK→SK→1, re-enrolled |
| Gr 12 | `graduate` | year closed w/ snapshot, **no** new enrollment, grade unchanged |
| No grade, age 18–59 mo | `shishu-stays` | re-enrolled into Shishu (still matches by age) |
| No grade, age ≥ 60 mo | `shishu-aged-out` | **flagged**, not auto-enrolled — admin assigns JK/SK |
| No grade, no/bad birthMonthYear | `needs-grade` | **flagged**, skipped |
| Grade off-ladder ("Kindergarten") | `needs-grade` | **flagged**, skipped |

## 6. Data-model changes (`@cmt/shared-domain`)

### 6.1 Enrollment: add `pid`, `levelSnapshots`, extend `enrolledVia`

`packages/shared-domain/src/setu/schemas/enrollment.ts`:

```ts
// NEW — per-child snapshot of the grade/level for THIS enrollment's year.
export const LevelSnapshotSchema = z.object({
  schoolGrade: z.string().nullable(), // the child's grade during this year ("3", "JK", null=shishu)
  levelId: z.string().nullable(),     // the matched level's id (null if no match / shishu age-only)
  levelName: z.string().nullable(),   // denormalized for display ("Level 2", "Shishu Vihar")
});
export type LevelSnapshot = z.infer<typeof LevelSnapshotSchema>;

export const EnrollmentDocSchema = z.object({
  // …existing fields…
  enrolledVia: z.enum(['family-initiated', 'first-attendance', 'welcome-team', 'promotion']), // + 'promotion'
  // NEW: roster join key. deriveRoster queries collectionGroup('enrollments').where('pid','==',level.pid).
  // Optional on read for back-compat with docs written before this field; ALWAYS written going forward.
  pid: z.string().optional(),
  // NEW: per-mid grade/level snapshot for this year. Keyed by mid.
  levelSnapshots: z.record(z.string(), LevelSnapshotSchema).optional(),
});
```

> **`pid` is the long-standing roster invariant** (`deriveRoster`, `roster.ts:118`). It was only written by the backfill; `enrollFamily` never wrote it, so a *new* family enrolling via the portal would not appear on a teacher roster. This spec **adds `pid: oid` to `enrollFamily`** (small correctness fix, §9.4) and to every enrollment the rollover writes.

### 6.2 No member-schema change

`schoolGrade` stays `z.string().nullable()`. Promotion writes the advanced grade string; the level is derived everywhere as today. Graduating children keep their grade (e.g. `"12"`) — they simply have no active enrollment, so no roster shows them.

## 7. The two engines (`apps/portal/src/features/setu/rollover/`)

A new feature directory (kebab-case, boundary-clean — imports only `@cmt/shared-domain` + firebase-shared). Pure-ish functions operating on an injected Firestore handle so the **same engine backs both the admin route and a CLI script** (mirrors the backfill pattern).

### 7.1 `start-new-year.ts` — clone levels + ensure offerings

```ts
export interface StartYearResult {
  fromYear: string; toYear: string;
  offeringsCreated: string[];   // oids
  offeringsExisting: string[];
  levelsCreated: string[];      // levelIds
  levelsExisting: string[];     // skipped (teacher assignments preserved)
  donationPeriodsCreated: string[];
}
export async function startNewYear(db, { fromYear, toYear, actorMid, dryRun }): Promise<StartYearResult>;
```

Algorithm (idempotent):
1. **Discover source offerings**: `offerings` where `programKey === BALA_VIHAR` and `termLabel === fromYear`. (Known seed oids: `bv-brampton-2025-26`, `bv-scarborough-2025-26`.)
2. For each source offering, derive the **target oid** by swapping the term slug in the oid (`bv-brampton-2025-26` → `bv-brampton-2026-27`) — **preserve the `bv-` prefix** so level `pid` / enrollment `pid` joins stay consistent across years. If the target offering already exists → record as existing; else create via the offering shape (copy programKey/programLabel/location/pricingTiers/amountTiers/termType, `termLabel = toYear`, `paymentSource: 'portal'`, `enabled: true`, next-year `startDate`/`endDate` = source dates + 1 year).
3. **Discover source levels**: `levels` where `pid === sourceOid`. For each, compute `newPid = targetOid`, `newLevelId = {location}-{levelSlug(levelName)}-{newPid}`. If `newLevelId` exists → **skip (do not clobber teacher assignments)**; else create copying `levelName/levelKind/order/gradeBand/ageLabel/curriculum`, with `teacherRefs: []`, `periodLabel: toYear`, `pid: newPid`, `enabled: true`.
4. **Donation-period parity**: the legacy levels-admin pid dropdown reads `donationPeriods`. Ensure a `donationPeriods/{targetOid}` doc exists (mirror of the offering) so the admin levels screen can show/edit 2026-27. Idempotent.
5. `dryRun` returns the same shape with `…Created` listing what *would* be created (no writes).

### 7.2 `promote-families.ts` — advance grades, close year, re-enroll

```ts
export interface PromotionRow {
  fid: string; mid: string; childName: string; location: Location | null;
  fromGrade: string | null; fromLevelName: string | null;
  outcome: PromotionOutcome;
  toGrade: string | null; toLevelName: string | null; // null for graduate / needs-attention
}
export interface RolloverReport {
  fromYear: string; toYear: string; dryRun: boolean;
  familiesProcessed: number; familiesSkippedAlreadyPromoted: number;
  promoted: number;        // headline: children getting a 2026-27 active enrollment (= advanced + shishuStayed)
  advanced: number;        // of `promoted`, children whose grade moved up a rung
  shishuStayed: number;    // of `promoted`, Shishu children re-enrolled with no grade change
  graduated: number; needsAttention: number;
  byTransition: { label: string; count: number }[];   // "Level 1 → Level 2", "Level 2 → Level 2", …
  graduates: PromotionRow[];
  attention: PromotionRow[];                            // shishu-aged-out + needs-grade (with family link)
  rows: PromotionRow[];                                 // full detail (dry-run only / capped)
}
export async function promoteFamilies(db, { fromYear, toYear, actorMid, dryRun }): Promise<RolloverReport>;
```

Algorithm:
1. Load **source levels** (per location, `pid === sourceOid`) and **target levels** (`pid === targetOid`) once into memory (~10 each per location).
2. Find families to process: `collectionGroup('enrollments').where('oid','==', sourceOid).where('status','==','active')` for each BV source oid. (Composite collectionGroup index required — §11.)
3. **Per family, in a single Firestore transaction** (atomic + idempotent):
   - `targetEid = {fid}-{targetOid}`. If a target enrollment already exists with `status: 'active'` → **skip** (`familiesSkippedAlreadyPromoted++`). This gate makes re-runs safe and prevents double-advancing a grade.
   - Read the family's members for the source enrollment's `enrolledMids`.
   - For each mid: derive `fromLevel` = match current grade against **source** levels (for the closing snapshot). Compute `decidePromotion(member, now)`.
     - `advance` → set `member.schoolGrade = to`; derive `toLevel` vs **target** levels; add to `promotedMids`; record both snapshots.
     - `shishu-stays` → keep grade; `toLevel` = shishu (by age vs target); add to `promotedMids`.
     - `graduate` → record source snapshot only; **not** in `promotedMids`.
     - `shishu-aged-out` / `needs-grade` → record in `attention`; **not** in `promotedMids`; member untouched.
   - **Close source**: update the 2025-26 enrollment → `status: 'cancelled'`, `cancelledAt: now`, `cancelledReason: 'promoted-' + toYear`, merge `levelSnapshots` (source-year grades/levels for every child).
   - **Create target** (only if `promotedMids` non-empty): write `{fid}-{targetOid}` with the full enrollment shape — `oid: targetOid`, **`pid: targetOid`**, `enrolledMids: promotedMids`, `enrolledVia: 'promotion'`, `termLabel: toYear`, `location`, `enrolledAt: now`, `suggestedAmountSnapshot` resolved from the target offering, `status: 'active'`, `levelSnapshots` (target-year), `cancelledAt: null`, `cancelledReason: null`.
   - Member writes (advanced grades) commit in the **same transaction** as the enrollment writes → no partial-advance on failure.
4. Aggregate counts + `byTransition` (group rows by `fromLevelName → toLevelName`, so the preview shows "Level 2 → Level 2: 30, Level 2 → Level 3: 23").
5. `dryRun: true` → run steps 1–4 with **no writes** (transactions become pure reads/computation), return the full `rows` for the preview table.

> **Scale:** ~500 families × one small transaction each, bounded concurrency (~10). Loading levels is the only broad read. Comfortably within the 300s function limit; the CLI script (§9.3) is the parity path for very large or repeated runs.

## 8. UI / UX (this must be best-in-class and obvious)

### 8.1 New admin tile

Add a tile on `/admin` (`apps/portal/src/app/admin/page.tsx`): **"School year rollover"** → `/admin/school-year`, with sublabel "Promote Bala Vihar to the next year". Themed with the existing admin tile system.

### 8.2 `/admin/school-year` — a guided 2-step flow

A single page that reads like a checklist. Setu `.csp` tokens, fully responsive (real `block md:hidden` mobile layout per the mobile-ready discipline), designer pass required.

```
┌────────────────────────────────────────────────────────────────────┐
│  School Year Rollover                                  Bala Vihar   │
│  Move every family from 2025-26 into 2026-27.                       │
│                                                                     │
│  ┌─ Active year ─────────┐   ┌─ Next year ──────────────────────┐  │
│  │  2025-26              │ → │  2026-27   ● Not started yet      │  │
│  └───────────────────────┘   └──────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  STEP 1 ·  Start 2026-27                              ○      │    │
│  │  Copies this year's levels and class offerings into next    │    │
│  │  year. Grade bands and curriculum carry over; teacher       │    │
│  │  assignments start empty so you can re-assign.              │    │
│  │                                                            │    │
│  │   • 18 levels to create  • 2 offerings to create           │    │
│  │                                          [ Start 2026-27 ]  │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  STEP 2 ·  Promote families            (locked until Step 1)│    │
│  │  Advances every child one grade, moves them into next       │    │
│  │  year's level, and closes their 2025-26 record (kept as     │    │
│  │  history). Graduating Grade 12 students complete the         │    │
│  │  program.                                                   │    │
│  │                                          [ Preview run ]    │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

**After Step 1 runs** → the card flips to a success state: green check, "2026-27 ready · 18 levels · 2 offerings created", and a subtle **"Re-sync"** link (refreshes non-teacher fields without clobbering assignments). The "Active/Next year" header updates "Next year ● Ready". Step 2 unlocks.

**Step 2 — Preview (dry-run) panel** (the heart of the UX — makes the two-grades-per-level transparent):

```
┌─ Promotion preview · 2025-26 → 2026-27 ────────────────────────────┐
│                                                                    │
│     480              18              14                            │
│  moving up         graduate     need attention                    │
│  (incl. 9 Shishu continuing)                                       │
│                                                                    │
│  Where students move ─────────────────────────────────────────    │
│   Pre-Level 1 → Level 1          47  ████████████                  │
│   Level 1 → Level 2              53  █████████████                 │
│   Level 2 → Level 2              30  ███████        (stay in band) │
│   Level 2 → Level 3              23  ██████                        │
│   Level 3 → Level 4 / stay …     …                                 │
│                                                                    │
│  ▸ Graduating (18)            Aanya R. · Dev P. · …  [expand]      │
│  ▸ Need attention (14)        ⚠ missing grade / aged out          │
│      Riya S.  (Sharma family)   no grade set      [ Fix → ]       │
│      …                                                             │
│                                                                    │
│   Nothing has changed yet. Review, then confirm below.            │
│                                  [ Promote 480 students → ]        │
└────────────────────────────────────────────────────────────────────┘
```

- The big three numbers are instantly scannable. The **"Where students move"** list is grouped `from → to` so an admin literally sees "30 stay in Level 2, 23 move to Level 3" — directly answering the two-grades-per-level worry.
- **Graduating** and **Need attention** are collapsible; each attention row has a **"Fix →"** deep-link to that child's edit screen (set a grade), so the admin can clear the list before committing.
- **Confirm**: the primary button opens a small dialog — *"Promote 480 students to 2026-27? This advances grades and closes the 2025-26 enrollments. History is preserved. This can't be undone with one click."* — **Confirm** / Cancel.
- **Result state** (after commit): same three numbers, now past-tense ("480 promoted · 18 graduated · 14 skipped"), plus **"View 2026-27 rosters →"** and **"Re-run preview"** (idempotent; will show 0 to advance).

**Mobile**: cards stack; the transition list becomes stacked rows ("Level 1 → Level 2 · 53"); the three stats become a horizontal scroll-free trio; buttons full-width. No web-only layout.

### 8.3 Child profile — "Bala Vihar journey" strip

On the member/child profile (`apps/portal/src/app/family/members/[mid]/page.tsx` and the welcome read-only detail), add a compact section fed by that child's enrollment `levelSnapshots` across years (sorted by `termLabel` desc):

```
┌─ Bala Vihar journey ───────────────────────────┐
│  ● 2026-27   Grade 4 · Level 3        Active    │
│  ○ 2025-26   Grade 3 · Level 2        Completed │
│  ○ 2024-25   Grade 2 · Level 2        Completed │
└─────────────────────────────────────────────────┘
```

Reads existing data only (no extra writes), themed, subtle. A graduate shows their final year as "Completed" with no active row.

### 8.4 Mobile + API-first (first-class requirement, not an afterthought)

Every surface in this feature must work seamlessly on web **and** mobile web, and every server action must be reachable by a future native mobile app through the same API. Concretely:

- **Every screen ships a real mobile layout** — the rollover page (two-step flow, preview panel, three-stat trio, transition list, attention list, confirm dialog) and the child-profile journey strip each have a genuine `block md:hidden` mobile branch (stacked cards, full-width buttons, no horizontal scroll), not a desktop layout crammed onto a phone. Designer pass covers both breakpoints.
- **All logic lives behind the API, never only in a server component.** The "Start", "Preview", and "Promote" actions are the `POST /api/admin/school-year/{start,promote}` routes (§9.1–9.2); the web UI calls them via a thin `-client` fetch wrapper (so a native app calls the identical endpoints). No business logic is embedded in the page that a mobile client couldn't reach.
- **Mobile-app-ready handler contract:** auth via `readSessionFromHeaders` (accepts both `Authorization: Bearer` and the session cookie); request/response bodies are plain JSON with **ISO-8601 strings** for all dates (no Firestore `Timestamp` leakage); request/response shapes are **shared Zod schemas** in `@cmt/shared-domain` (`RolloverReport`, `StartYearResult`, `LevelSnapshot`, the request bodies) so web and native decode the exact same types.
- **`.csp` token scoping:** any fixed bar, dialog, or sheet rendered outside a `CspRoot` must carry `className="csp"` or be wrapped, or it renders unstyled on mobile.

## 9. API + scripts

### 9.1 `POST /api/admin/school-year/start`
Body `{ fromYear?, toYear?, dryRun?: boolean }` (defaults 2025-26 → 2026-27). Returns `StartYearResult`. Admin-gated automatically by the `/api/admin/` catch-all in `canAccessRoute`; add an in-handler `isAdmin(session)` check for defense-in-depth (mirror the offerings route). Mobile-ready: auth via `readSessionFromHeaders` (Bearer + cookie), ISO-string JSON. `revalidateTag('offerings')`, `revalidateTag('levels')`.

### 9.2 `POST /api/admin/school-year/promote`
Body `{ fromYear?, toYear?, dryRun: boolean }`. `dryRun:true` → preview `RolloverReport` (no writes). `dryRun:false` → commit. Same gating/auth/JSON rules. On commit, revalidate enrollment/roster/dashboard tags. **E2E note:** mutation routes must mock `next/cache` `revalidateTag` in tests (known harness quirk).

### 9.3 CLI parity scripts (`apps/portal/scripts/`)
- `start-new-year.ts` — alias `school-year:start`.
- `promote-families.ts` — alias `school-year:promote`, flags `--dry-run`, `--from`, `--to`, `--limit N`, `--fid X`, `--allow-prod` (refuses non-UAT target otherwise — same guard as the backfill).
- Both registered as `pnpm` aliases in `apps/portal/package.json` using `tsx --env-file=.env.local` (CLI scripts need the env-file alias or `PROJECT_ID` is undefined).

### 9.4 `enrollFamily` correctness fix
Add `pid: oid` to the enrollment doc written by `enroll-family.ts` so portal-initiated enrollments also appear on teacher rosters (latent bug, in-scope because the rollover formalizes the `pid` invariant). Covered by a test asserting the written doc has `pid === oid`.

## 10. Tests (TDD — assertions ship in the same commit as the logic)

- **`grade-ladder.test.ts`**: JK→SK→1; 3→4; 11→12; 12→graduate; "Grade 3"/"Gr 3"/"3" all advance to 4; off-ladder ("Kindergarten")→needs-grade; null grade + 30mo→shishu-stays; null grade + 66mo→shishu-aged-out; null grade + null birthMonthYear→needs-grade.
- **`promote-families.test.ts`** (fake-firestore): **N=2 family** with two children in one 2025-26 enrollment — Gr 2 (stays Level 2) + Gr 3 (→ Level 3): assert both member grades advance, source enrollment `status:'cancelled'` with `levelSnapshots` for **both** mids (old grades/levels), target enrollment created with `pid===targetOid`, `enrolledVia:'promotion'`, `enrolledMids` = both, target `levelSnapshots` (new). **Idempotent re-run** → `familiesSkippedAlreadyPromoted` increments, no double-advance. **Graduate** (Gr 12) excluded from target `enrolledMids`, source snapshot present, member grade unchanged. **needs-grade** child in `attention`, untouched. **Dry-run** writes nothing but returns identical counts + `byTransition`.
- **`start-new-year.test.ts`**: clones levels with `gradeBand` preserved, `teacherRefs:[]`, `pid===targetOid`, `periodLabel===toYear`; creates target offering; **idempotent** — existing target level is skipped and its `teacherRefs` are **not** clobbered on re-sync.
- **`enroll-family` test**: written doc has `pid === oid`.
- **UI**: rollover page renders the two steps + Step-2 locked until Step-1 done; preview panel renders the three counts + `byTransition` rows + attention deep-links; confirm dialog gates commit. Child-profile journey strip renders years desc from `levelSnapshots`, "Active" vs "Completed".

## 11. Firestore index

The promote engine queries `collectionGroup('enrollments').where('oid','==',…).where('status','==','active')`. Add a **collectionGroup composite index** on `enrollments (oid ASC, status ASC)` to `firestore.indexes.json`. Deploy to **UAT only** (`chinmaya-setu-uat`), **never** `--force` against prod `chinmaya-setu-715b8` (shared with the standalone check-in app). fake-firestore does not enforce indexes, so this must be remembered for the live run (covered in §12).

## 12. Rollout / verification

1. Ship behind no new flag (admin-only surface; harmless until used). All commits → `main`, pushed (full pre-push gate).
2. Deploy the new index to UAT: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` (no `--force`).
3. **UAT walkthrough (mock-free, can't be skipped):**
   - Run **Step 1** → confirm 2026-27 levels exist (correct bands, empty teachers) + offerings present.
   - Run **Step 2 Preview** → counts ≈ the 512 backfilled families; spot-check a Brampton Level 2 split (some stay, some → Level 3) and a Scarborough level; confirm graduates + attention lists look right.
   - **Commit** → re-open a promoted family: child profile shows the new grade/level + the journey strip with 2025-26 "Completed" and 2026-27 "Active"; teacher roster for a 2026-27 level shows the promoted kids; the 2025-26 roster no longer shows them.
   - **Re-run preview** → 0 to advance (idempotency proven live).
4. End-of-task summary states plainly which steps were UAT-verified vs only unit-tested.

## 13. Standing constraints (non-negotiable)

UAT writes only (`chinmaya-setu-uat`); prod `chinmaya-setu-715b8` is read-only and never `--force`-indexed; never `--no-verify`; always `git push` after an authorized commit; subagents on Opus; `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` (no `undefined` assigned to optionals — use conditional spreads); mobile-app-ready APIs (`readSessionFromHeaders`, ISO JSON, shared schemas) + real mobile layouts; role checks via helpers (`isAdmin`, never `=== 'admin'`); new `/api/setu|admin/*` paths explicitly handled in `canAccessRoute` (the `/api/admin/` catch-all already covers these — verify); Zod claim/doc schemas must include any new field or it's silently stripped; designer pass on every UI slice; full `pnpm --filter @cmt/portal lint` before each commit.

## 14. Explicitly NOT in scope (YAGNI)

- A full "journey timeline" visualization (only the compact history strip ships now).
- A structured `schoolYear` field / global "current year" source of truth (termLabel + oids remain the key).
- Per-kid override UI during promotion (the run is automatic; the "Fix →" deep-links + dry-run cover correction).
- Mid-year transfers, hold-backs as a first-class feature (a held-back child is handled by editing their grade before the run; not a dedicated flow).
- Promoting non-BV programs (Tabla etc.) — the engine is BV-scoped; generalizing is a later concern.

## 15. Open items to confirm during implementation

- The exact source oids/`programKey` value in UAT (`bv-brampton-2025-26` etc.) — discover via query, fall back to known ids.
- Whether 2026-27 offerings already exist as `offerings` docs (seed wrote `donationPeriods`); `startNewYear` is idempotent either way.
- Scarborough Pre-Level / top-level naming (`Pre-Level A`, `Level E` = Gr 9–12) — clone copies verbatim, no assumption.
