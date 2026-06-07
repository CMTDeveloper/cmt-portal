# Bala Vihar School-Year Rollover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship admin-driven, one-click promotion of every Bala Vihar child to the next school year — advance each child one grade, re-derive their level from the grade band, close the old enrollment with a per-child history snapshot, create the new-year enrollment — plus a "Start new year" clone of levels + offerings, with web + mobile UI and mobile-app-ready APIs.

**Architecture:** Pure domain logic in `@cmt/shared-domain` (grade ladder + schemas), two engines in `apps/portal/src/features/setu/rollover/` (`startNewYear`, `promoteFamilies`) injected with a Firestore handle so the same code backs both an admin API route and a CLI script. A guided two-step admin page calls the routes via thin `-client` wrappers. History surfaces as a "Bala Vihar journey" strip on the child profile, read from `levelSnapshots` on enrollments.

**Tech Stack:** Next.js 16 (App Router, Cache Components), TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod, Firestore (admin SDK), Vitest + fake-firestore, Setu `.csp` theme tokens.

**Spec:** `docs/superpowers/specs/2026-06-07-bala-vihar-school-year-rollover-design.md` (read it for the UX wireframes + rationale).

---

## File Structure

**Shared domain** (`packages/shared-domain/src/setu/`):
- `grade-ladder.ts` (NEW) — `GRADE_LADDER`, `PromotionOutcome`, `decidePromotion`. Pure, web+mobile.
- `grade-ladder.test.ts` (NEW)
- `schemas/enrollment.ts` (MODIFY) — `LevelSnapshotSchema`, `pid`, `levelSnapshots`, `'promotion'` in `enrolledVia`.
- `schemas/rollover.ts` (NEW) — `StartYearResultSchema`, `RolloverReportSchema`, `PromotionRowSchema` + request-body schemas (shared web↔native).
- `index.ts` (MODIFY) — export the two new modules.

**Portal feature** (`apps/portal/src/features/setu/rollover/`):
- `school-year.ts` (NEW) — `deriveSchoolYears`, `targetOidOf`, `BV_SOURCE_OIDS`, `loadLevelsByPid`, `buildLevelSnapshot`.
- `start-new-year.ts` (NEW) + `__tests__/start-new-year.test.ts`
- `plan-family-promotion.ts` (NEW, pure planner) + `__tests__/plan-family-promotion.test.ts`
- `promote-families.ts` (NEW, applier/engine) + `__tests__/promote-families.test.ts`
- `rollover-client.ts` (NEW) — `startNewYearClient`, `previewPromotionClient`, `commitPromotionClient`.
- `components/rollover-page.tsx`, `components/start-step.tsx`, `components/promote-step.tsx`, `components/promotion-preview.tsx`, `components/confirm-dialog.tsx` (NEW) + `__tests__/`
- `get-child-journey.ts` (NEW) — read `levelSnapshots` across a child's enrollments.
- `components/journey-strip.tsx` (NEW) + test

**API** (`apps/portal/src/app/api/admin/school-year/`):
- `start/route.ts` (NEW), `promote/route.ts` (NEW) + `__tests__/`

**Admin page** (`apps/portal/src/app/admin/school-year/`):
- `page.tsx` (NEW), `error.tsx` (NEW). MODIFY `apps/portal/src/app/admin/page.tsx` (add tile).

**Child profile**: MODIFY `apps/portal/src/app/family/members/[mid]/page.tsx` + the welcome read-only detail to render `JourneyStrip`.

**Scripts** (`apps/portal/scripts/`): `start-new-year.ts`, `promote-families.ts` (NEW). MODIFY `apps/portal/package.json` (aliases). MODIFY `firestore.indexes.json`.

**`enrollFamily` fix**: MODIFY `apps/portal/src/features/setu/enrollment/enroll-family.ts`.

---

## Task 1: Enrollment + rollover schemas (`@cmt/shared-domain`)

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/enrollment.ts`
- Create: `packages/shared-domain/src/setu/schemas/rollover.ts`
- Create: `packages/shared-domain/src/setu/schemas/__tests__/rollover.test.ts`
- Modify: `packages/shared-domain/src/setu/index.ts`

- [ ] **Step 1: Write the failing test** — `schemas/__tests__/rollover.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  EnrollmentDocSchema,
  LevelSnapshotSchema,
  RolloverReportSchema,
  StartYearResultSchema,
} from '../../index';

describe('enrollment schema — rollover extensions', () => {
  const base = {
    eid: 'F1-bv-brampton-2026-27', fid: 'F1', oid: 'bv-brampton-2026-27',
    programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: '2026-27',
    location: 'Brampton', enrolledAt: new Date(), enrolledVia: 'promotion',
    enrolledByMid: null, enrolledMids: ['F1-02'],
    suggestedAmountSnapshot: 0, suggestedAmountOverride: null,
    status: 'active', cancelledAt: null, cancelledReason: null,
  };

  it('accepts pid, levelSnapshots, and enrolledVia=promotion', () => {
    const parsed = EnrollmentDocSchema.parse({
      ...base,
      pid: 'bv-brampton-2026-27',
      levelSnapshots: { 'F1-02': { schoolGrade: '4', levelId: 'brampton-level-3-bv-brampton-2026-27', levelName: 'Level 3' } },
    });
    expect(parsed.pid).toBe('bv-brampton-2026-27');
    expect(parsed.levelSnapshots?.['F1-02']?.levelName).toBe('Level 3');
  });

  it('still parses a legacy doc with no pid / no levelSnapshots', () => {
    const parsed = EnrollmentDocSchema.parse({ ...base, enrolledVia: 'welcome-team' });
    expect(parsed.pid).toBeUndefined();
  });

  it('LevelSnapshot allows null grade/level (shishu / no match)', () => {
    expect(LevelSnapshotSchema.parse({ schoolGrade: null, levelId: null, levelName: 'Shishu Vihar' }).schoolGrade).toBeNull();
  });
});

describe('rollover response schemas', () => {
  it('parses a RolloverReport', () => {
    const r = RolloverReportSchema.parse({
      fromYear: '2025-26', toYear: '2026-27', dryRun: true,
      familiesProcessed: 2, familiesSkippedAlreadyPromoted: 0,
      promoted: 3, advanced: 2, shishuStayed: 1, graduated: 1, needsAttention: 1,
      byTransition: [{ label: 'Level 2 → Level 3', count: 1 }],
      graduates: [], attention: [], rows: [],
    });
    expect(r.promoted).toBe(3);
  });
  it('parses a StartYearResult', () => {
    const s = StartYearResultSchema.parse({
      fromYear: '2025-26', toYear: '2026-27',
      offeringsCreated: ['bv-brampton-2026-27'], offeringsExisting: [],
      levelsCreated: ['brampton-level-1-bv-brampton-2026-27'], levelsExisting: [],
      donationPeriodsCreated: ['bv-brampton-2026-27'],
    });
    expect(s.levelsCreated).toHaveLength(1);
  });
});
```

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/rollover.test.ts` → FAIL (schemas not defined).

- [ ] **Step 2: Extend `enrollment.ts`.** Add before `EnrollmentDocSchema`:

```ts
// Per-child snapshot of the grade/level for THIS enrollment's school year.
// Enables a child's Bala Vihar "journey" across years without a new collection.
export const LevelSnapshotSchema = z.object({
  schoolGrade: z.string().nullable(), // grade that year ("3","JK") or null for shishu
  levelId: z.string().nullable(),     // matched level id, or null if no match
  levelName: z.string().nullable(),   // denormalized for display ("Level 2","Shishu Vihar")
});
export type LevelSnapshot = z.infer<typeof LevelSnapshotSchema>;
```

In `EnrollmentDocSchema`: change `enrolledVia` to `z.enum(['family-initiated', 'first-attendance', 'welcome-team', 'promotion'])`, and add (after `cancelledReason`):

```ts
  // Roster join key (deriveRoster queries where('pid','==',level.pid)). Optional
  // on read for back-compat; ALWAYS written going forward.
  pid: z.string().optional(),
  // Per-mid grade/level snapshot for this enrollment's year. Keyed by mid.
  levelSnapshots: z.record(z.string(), LevelSnapshotSchema).optional(),
```

- [ ] **Step 3: Create `schemas/rollover.ts`:**

```ts
import { z } from 'zod';

export const PromotionOutcomeKind = z.enum([
  'advance', 'graduate', 'shishu-stays', 'shishu-aged-out', 'needs-grade',
]);

export const PromotionRowSchema = z.object({
  fid: z.string(), mid: z.string(), childName: z.string(),
  location: z.string().nullable(),
  outcomeKind: PromotionOutcomeKind,
  fromGrade: z.string().nullable(), fromLevelName: z.string().nullable(),
  toGrade: z.string().nullable(), toLevelName: z.string().nullable(),
});
export type PromotionRow = z.infer<typeof PromotionRowSchema>;

export const RolloverReportSchema = z.object({
  fromYear: z.string(), toYear: z.string(), dryRun: z.boolean(),
  familiesProcessed: z.number().int(), familiesSkippedAlreadyPromoted: z.number().int(),
  promoted: z.number().int(), advanced: z.number().int(), shishuStayed: z.number().int(),
  graduated: z.number().int(), needsAttention: z.number().int(),
  byTransition: z.array(z.object({ label: z.string(), count: z.number().int() })),
  graduates: z.array(PromotionRowSchema),
  attention: z.array(PromotionRowSchema),
  rows: z.array(PromotionRowSchema),
});
export type RolloverReport = z.infer<typeof RolloverReportSchema>;

export const StartYearResultSchema = z.object({
  fromYear: z.string(), toYear: z.string(),
  offeringsCreated: z.array(z.string()), offeringsExisting: z.array(z.string()),
  levelsCreated: z.array(z.string()), levelsExisting: z.array(z.string()),
  donationPeriodsCreated: z.array(z.string()),
});
export type StartYearResult = z.infer<typeof StartYearResultSchema>;

// Request bodies (shared web↔native). Years optional → engine defaults.
export const StartYearBodySchema = z.object({
  fromYear: z.string().optional(), toYear: z.string().optional(),
});
export const PromoteBodySchema = z.object({
  fromYear: z.string().optional(), toYear: z.string().optional(),
  dryRun: z.boolean(),
});
```

- [ ] **Step 4: Export from `index.ts`** — add `export * from './schemas/rollover';` and `export * from './grade-ladder';` (the ladder lands in Task 2; adding the export now is harmless — if Task 2 isn't done yet, remove the grade-ladder line and re-add in Task 2). Prefer: add only the `rollover` export here; add the `grade-ladder` export in Task 2.

- [ ] **Step 5: Run** `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/rollover.test.ts` → PASS. Then `pnpm --filter @cmt/shared-domain exec tsc --noEmit`.

- [ ] **Step 6: Commit** `feat(domain): enrollment levelSnapshots + pid + promotion enrolledVia; rollover response schemas`.

---

## Task 2: Grade ladder (`@cmt/shared-domain`)

**Files:**
- Create: `packages/shared-domain/src/setu/grade-ladder.ts`
- Create: `packages/shared-domain/src/setu/__tests__/grade-ladder.test.ts`
- Modify: `packages/shared-domain/src/setu/index.ts` (add `export * from './grade-ladder';`)

- [ ] **Step 1: Write the failing test** — `__tests__/grade-ladder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decidePromotion, GRADE_LADDER } from '../grade-ladder';

const NOW = new Date('2026-06-07T00:00:00Z');
function child(schoolGrade: string | null, birthMonthYear: string | null = null) {
  return { schoolGrade, birthMonthYear };
}

describe('GRADE_LADDER', () => {
  it('runs JK,SK,1..12', () => {
    expect(GRADE_LADDER[0]).toBe('JK');
    expect(GRADE_LADDER[1]).toBe('SK');
    expect(GRADE_LADDER[GRADE_LADDER.length - 1]).toBe('12');
  });
});

describe('decidePromotion', () => {
  it('advances a numeric grade one rung', () => {
    expect(decidePromotion(child('3'), NOW)).toEqual({ kind: 'advance', from: '3', to: '4' });
  });
  it('normalizes "Grade 3" / "Gr 3" before advancing', () => {
    expect(decidePromotion(child('Grade 3'), NOW)).toEqual({ kind: 'advance', from: '3', to: '4' });
    expect(decidePromotion(child('Gr 3'), NOW)).toEqual({ kind: 'advance', from: '3', to: '4' });
  });
  it('advances JK→SK and SK→1', () => {
    expect(decidePromotion(child('JK'), NOW)).toEqual({ kind: 'advance', from: 'JK', to: 'SK' });
    expect(decidePromotion(child('SK'), NOW)).toEqual({ kind: 'advance', from: 'SK', to: '1' });
  });
  it('graduates Grade 12', () => {
    expect(decidePromotion(child('12'), NOW)).toEqual({ kind: 'graduate', from: '12' });
  });
  it('flags an off-ladder grade as needs-grade', () => {
    expect(decidePromotion(child('Kindergarten'), NOW).kind).toBe('needs-grade');
    expect(decidePromotion(child('13'), NOW).kind).toBe('needs-grade');
  });
  it('shishu-age child with no grade → shishu-stays', () => {
    // 30 months old at NOW → born ~2023-12
    expect(decidePromotion(child(null, '2023-12'), NOW).kind).toBe('shishu-stays');
  });
  it('no grade + aged out of shishu (≥60mo) → shishu-aged-out', () => {
    expect(decidePromotion(child(null, '2020-01'), NOW).kind).toBe('shishu-aged-out');
  });
  it('no grade + no/bad birthMonthYear → needs-grade', () => {
    expect(decidePromotion(child(null, null), NOW).kind).toBe('needs-grade');
    expect(decidePromotion(child(null, 'xxxx'), NOW).kind).toBe('needs-grade');
  });
});
```

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/grade-ladder.test.ts` → FAIL.

- [ ] **Step 2: Implement `grade-ladder.ts`:**

```ts
import { normalizeGrade, SHISHU_MIN_MONTHS, SHISHU_MAX_MONTHS } from './schemas/level';

// Ordered rungs. JK & SK precede Grade 1; Grade 12 is terminal (graduates).
export const GRADE_LADDER = ['JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

export type PromotionOutcome =
  | { kind: 'advance'; from: string; to: string }
  | { kind: 'graduate'; from: '12' }
  | { kind: 'shishu-stays' }
  | { kind: 'shishu-aged-out' }
  | { kind: 'needs-grade' };

// Normalized ladder index map. JK/SK lowercased to match normalizeGrade output.
const LADDER_INDEX = new Map<string, number>(
  GRADE_LADDER.map((g, i) => [normalizeGrade(g), i]),
);

function ageInMonths(birthMonthYear: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(birthMonthYear);
  if (!m) return null;
  const by = Number(m[1]); const bm = Number(m[2]);
  if (bm < 1 || bm > 12) return null;
  return (now.getUTCFullYear() - by) * 12 + (now.getUTCMonth() + 1 - bm);
}

/**
 * Decide a child's promotion outcome from their member fields. Single source of
 * truth — used by both the dry-run preview and the commit engine.
 */
export function decidePromotion(
  member: { schoolGrade: string | null; birthMonthYear: string | null },
  now: Date,
): PromotionOutcome {
  if (member.schoolGrade != null && member.schoolGrade.trim() !== '') {
    const g = normalizeGrade(member.schoolGrade);
    const idx = LADDER_INDEX.get(g);
    if (idx == null) return { kind: 'needs-grade' };          // off-ladder ("kindergarten","13")
    if (idx === GRADE_LADDER.length - 1) return { kind: 'graduate', from: '12' };
    return { kind: 'advance', from: GRADE_LADDER[idx]!, to: GRADE_LADDER[idx + 1]! };
  }
  // No grade → shishu by age, or flag.
  if (member.birthMonthYear == null) return { kind: 'needs-grade' };
  const months = ageInMonths(member.birthMonthYear, now);
  if (months == null) return { kind: 'needs-grade' };
  if (months >= SHISHU_MIN_MONTHS && months < SHISHU_MAX_MONTHS) return { kind: 'shishu-stays' };
  if (months >= SHISHU_MAX_MONTHS) return { kind: 'shishu-aged-out' };
  return { kind: 'needs-grade' }; // younger than shishu window — unusual; flag
}
```

> Note: `advance.from`/`to` use the **canonical ladder label** (`'JK'`, `'3'`) so the value written to `schoolGrade` is clean (not the user's `"Grade 3"`). This intentionally normalizes grade strings on promotion.

- [ ] **Step 3: Add export** to `index.ts`: `export * from './grade-ladder';`
- [ ] **Step 4: Run** the test → PASS. `pnpm --filter @cmt/shared-domain exec tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(domain): grade ladder + decidePromotion (JK→SK→1..12→graduate)`.

---

## Task 3: Rollover shared helpers (`features/setu/rollover/school-year.ts`)

Pure helpers used by both engines + routes: year derivation, oid mapping, level loading, snapshot building.

**Files:**
- Create: `apps/portal/src/features/setu/rollover/school-year.ts`
- Create: `apps/portal/src/features/setu/rollover/__tests__/school-year.test.ts`

- [ ] **Step 1: Write the failing test** covering the pure helpers (`targetOidOf`, `buildLevelSnapshot`):

```ts
import { describe, it, expect } from 'vitest';
import { targetOidOf, buildLevelSnapshot } from '../school-year';

describe('targetOidOf', () => {
  it('swaps the term in a bv oid, preserving prefix+location', () => {
    expect(targetOidOf('bv-brampton-2025-26', '2025-26', '2026-27')).toBe('bv-brampton-2026-27');
    expect(targetOidOf('bv-scarborough-2025-26', '2025-26', '2026-27')).toBe('bv-scarborough-2026-27');
  });
});

describe('buildLevelSnapshot', () => {
  const levels = [
    { levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2', levelKind: 'level', gradeBand: ['2', '3'] },
    { levelId: 'brampton-shishu-vihar-bv-brampton-2025-26', levelName: 'Shishu Vihar', levelKind: 'shishu', gradeBand: [] },
  ];
  const NOW = new Date('2026-06-07T00:00:00Z');
  it('matches a grade to a level snapshot', () => {
    const snap = buildLevelSnapshot({ schoolGrade: '3', birthMonthYear: null }, levels, NOW);
    expect(snap).toEqual({ schoolGrade: '3', levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2' });
  });
  it('returns null level when no band matches', () => {
    const snap = buildLevelSnapshot({ schoolGrade: '9', birthMonthYear: null }, levels, NOW);
    expect(snap).toEqual({ schoolGrade: '9', levelId: null, levelName: null });
  });
  it('matches shishu by age (null grade)', () => {
    const snap = buildLevelSnapshot({ schoolGrade: null, birthMonthYear: '2023-12' }, levels, NOW);
    expect(snap.levelName).toBe('Shishu Vihar');
    expect(snap.schoolGrade).toBeNull();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `school-year.ts`:**

```ts
import { memberMatchesLevel, type LevelDoc, type LevelSnapshot, BALA_VIHAR } from '@cmt/shared-domain';
import { toSafeSlug } from '@cmt/shared-domain'; // if exported; else inline slug like levelSlug

export const DEFAULT_FROM_YEAR = '2025-26';
export const DEFAULT_TO_YEAR = '2026-27';
export const BV_SOURCE_OIDS = ['bv-brampton-2025-26', 'bv-scarborough-2025-26'] as const;

/** Swap the term-slug suffix of an oid: bv-brampton-2025-26 → bv-brampton-2026-27. */
export function targetOidOf(sourceOid: string, fromYear: string, toYear: string): string {
  const fromSlug = toSafeSlug(fromYear); // "2025-26"
  const toSlug = toSafeSlug(toYear);
  if (sourceOid.endsWith(`-${fromSlug}`)) return sourceOid.slice(0, -fromSlug.length) + toSlug;
  return `${sourceOid}-${toSlug}`; // defensive fallback
}

type LevelLite = Pick<LevelDoc, 'levelId' | 'levelName' | 'levelKind' | 'gradeBand'>;

/** Match a member to a level among `levels` and return the snapshot (level may be null). */
export function buildLevelSnapshot(
  member: { schoolGrade: string | null; birthMonthYear: string | null },
  levels: LevelLite[],
  now: Date,
): LevelSnapshot {
  const match = levels.find((lv) =>
    memberMatchesLevel({ type: 'Child', schoolGrade: member.schoolGrade, birthMonthYear: member.birthMonthYear }, lv, now),
  );
  return {
    schoolGrade: member.schoolGrade,
    levelId: match?.levelId ?? null,
    levelName: match?.levelName ?? null,
  };
}
```

> Confirm `toSafeSlug` is exported from `@cmt/shared-domain` (it lives at `packages/shared-domain/src/utils/slug.ts`; `levelSlug` in `level.ts` wraps it). If not exported at the package root, import via the level module's `levelSlug` for level-name slugs and inline a `term.toLowerCase()` for the year (years are already slug-safe). Implementer verifies.

- [ ] **Step 3: Run** `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover/__tests__/school-year.test.ts` → PASS. `pnpm --filter @cmt/portal exec tsc --noEmit`.
- [ ] **Step 4: Commit** `feat(rollover): school-year helpers (targetOidOf, buildLevelSnapshot)`.

---

## Task 4: `startNewYear` engine

Clone 2025-26 levels → 2026-27 (empty teachers), ensure 2026-27 offerings + donationPeriods exist. Idempotent. Injected db handle.

**Files:**
- Create: `apps/portal/src/features/setu/rollover/start-new-year.ts`
- Create: `apps/portal/src/features/setu/rollover/__tests__/start-new-year.test.ts`

- [ ] **Step 1: Write the failing test** (fake-firestore — mirror the helper used in `roster.test.ts`/`promote` tests). Seed one source offering `bv-brampton-2025-26` + two source levels (`Level 1` band `['1']`, `Shishu Vihar`). Assert after `startNewYear(db, { fromYear:'2025-26', toYear:'2026-27', actorMid:'A1', dryRun:false })`:
  - target offering `bv-brampton-2026-27` created with `termLabel:'2026-27'`, `paymentSource:'portal'`.
  - target levels created: `levelId` ends with `-bv-brampton-2026-27`, `pid==='bv-brampton-2026-27'`, `periodLabel==='2026-27'`, `gradeBand` preserved, `teacherRefs: []`.
  - `donationPeriods/bv-brampton-2026-27` created.
  - Re-run is idempotent: pre-seed a target level WITH `teacherRefs:['T9']`; assert after a second `startNewYear` that level's `teacherRefs` is still `['T9']` (not clobbered) and it's reported in `levelsExisting`.
  - `dryRun:true` writes nothing but returns the would-create lists.

Run → FAIL.

- [ ] **Step 2: Implement `start-new-year.ts`** with this contract + algorithm (from spec §7.1):

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { BALA_VIHAR, levelSlug, type LevelDoc, type OfferingDoc, type StartYearResult } from '@cmt/shared-domain';
import { DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, targetOidOf } from './school-year';

type Db = FirebaseFirestore.Firestore;
interface StartArgs { fromYear?: string; toYear?: string; actorMid: string; dryRun: boolean; }

export async function startNewYear(db: Db, args: StartArgs): Promise<StartYearResult> {
  const fromYear = args.fromYear ?? DEFAULT_FROM_YEAR;
  const toYear = args.toYear ?? DEFAULT_TO_YEAR;
  // 1. Discover source BV offerings (programKey==bala-vihar AND termLabel==fromYear).
  // 2. For each, compute targetOid; create the target offering if missing
  //    (copy programKey/programLabel/location/pricingTiers/amountTiers/termType;
  //     termLabel=toYear; paymentSource:'portal'; enabled:true;
  //     startDate/endDate = source + 1 year). Mirror a donationPeriods/{targetOid} doc.
  // 3. Discover source levels (where pid==sourceOid). For each, compute
  //    newLevelId = `${location}-${levelSlug(levelName)}-${targetOid}` (lowercased
  //    location to match existing ids — verify against a seeded level id). If the
  //    target level exists → push to levelsExisting (DO NOT overwrite teacherRefs).
  //    Else create copying levelName/levelKind/order/gradeBand/ageLabel/curriculum,
  //    teacherRefs:[], pid:targetOid, periodLabel:toYear, enabled:true,
  //    createdAt/updatedAt=serverTimestamp, createdBy/updatedBy=actorMid.
  // 4. dryRun → compute the same lists, perform NO writes.
  // Return StartYearResult.
}
```

Implementation notes:
- Use a Firestore `WriteBatch` (or sequential `set` with `create`-if-missing reads) — keep idempotency by reading existence first.
- `location` in the levelId: derive from the source level's `levelId` prefix (split on the source slug) rather than re-slugging, to guarantee the new id matches the established scheme. Simpler+safer: `newLevelId = sourceLevelId.replace(sourceOid, targetOid)`. Use that.
- For `startDate`/`endDate` + 1 year: construct `new Date(Date.UTC(y+1, ...))` from the source dates. (Date.now is fine here — engine runs server-side, not in a workflow script.)

- [ ] **Step 3: Run** the test → PASS. tsc.
- [ ] **Step 4: Commit** `feat(rollover): startNewYear clones levels + ensures offerings (idempotent, teachers preserved)`.

---

## Task 5: `planFamilyPromotion` (pure planner)

The testable crux: given a family's enrollment + members + source/target levels, compute the promotion plan. NO Firestore — pure.

**Files:**
- Create: `apps/portal/src/features/setu/rollover/plan-family-promotion.ts`
- Create: `apps/portal/src/features/setu/rollover/__tests__/plan-family-promotion.test.ts`

- [ ] **Step 1: Write the failing test** — the **N=2 case** is mandatory:

```ts
import { describe, it, expect } from 'vitest';
import { planFamilyPromotion } from '../plan-family-promotion';

const NOW = new Date('2026-06-07T00:00:00Z');
const srcLevels = [
  { levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2', levelKind: 'level', gradeBand: ['2', '3'] },
  { levelId: 'brampton-level-3-bv-brampton-2025-26', levelName: 'Level 3', levelKind: 'level', gradeBand: ['4', '5'] },
];
const tgtLevels = [
  { levelId: 'brampton-level-2-bv-brampton-2026-27', levelName: 'Level 2', levelKind: 'level', gradeBand: ['2', '3'] },
  { levelId: 'brampton-level-3-bv-brampton-2026-27', levelName: 'Level 3', levelKind: 'level', gradeBand: ['4', '5'] },
];

it('N=2: Gr2 stays Level 2, Gr3 → Level 3', () => {
  const plan = planFamilyPromotion({
    fid: 'F1', location: 'Brampton',
    enrolledMids: ['F1-02', 'F1-03'],
    members: [
      { mid: 'F1-02', firstName: 'A', lastName: 'R', type: 'Child', schoolGrade: '2', birthMonthYear: null },
      { mid: 'F1-03', firstName: 'B', lastName: 'R', type: 'Child', schoolGrade: '3', birthMonthYear: null },
    ],
    srcLevels, tgtLevels, now: NOW,
  });
  expect(plan.gradeUpdates).toEqual([
    { mid: 'F1-02', schoolGrade: '3' },
    { mid: 'F1-03', schoolGrade: '4' },
  ]);
  expect(plan.promotedMids).toEqual(['F1-02', 'F1-03']);
  expect(plan.sourceSnapshots['F1-02']).toEqual({ schoolGrade: '2', levelId: 'brampton-level-2-bv-brampton-2025-26', levelName: 'Level 2' });
  expect(plan.targetSnapshots['F1-02']).toEqual({ schoolGrade: '3', levelId: 'brampton-level-2-bv-brampton-2026-27', levelName: 'Level 2' });
  expect(plan.targetSnapshots['F1-03']).toEqual({ schoolGrade: '4', levelId: 'brampton-level-3-bv-brampton-2026-27', levelName: 'Level 3' });
  // rows carry transitions for the preview
  expect(plan.rows.find(r => r.mid === 'F1-03')?.toLevelName).toBe('Level 3');
});

it('graduate (Gr12) is excluded from promotedMids but snapshotted', () => {
  const plan = planFamilyPromotion({
    fid: 'F2', location: 'Brampton', enrolledMids: ['F2-02'],
    members: [{ mid: 'F2-02', firstName: 'G', lastName: 'P', type: 'Child', schoolGrade: '12', birthMonthYear: null }],
    srcLevels: [{ levelId: 'l7', levelName: 'Level 7', levelKind: 'level', gradeBand: ['11', '12'] }],
    tgtLevels, now: NOW,
  });
  expect(plan.promotedMids).toEqual([]);
  expect(plan.gradeUpdates).toEqual([]);
  expect(plan.rows[0]?.outcomeKind).toBe('graduate');
  expect(plan.sourceSnapshots['F2-02']?.levelName).toBe('Level 7');
});

it('needs-grade child is flagged, untouched', () => {
  const plan = planFamilyPromotion({
    fid: 'F3', location: 'Brampton', enrolledMids: ['F3-02'],
    members: [{ mid: 'F3-02', firstName: 'R', lastName: 'S', type: 'Child', schoolGrade: null, birthMonthYear: null }],
    srcLevels, tgtLevels, now: NOW,
  });
  expect(plan.promotedMids).toEqual([]);
  expect(plan.rows[0]?.outcomeKind).toBe('needs-grade');
});
```

Run → FAIL.

- [ ] **Step 2: Implement `plan-family-promotion.ts`:**

```ts
import { decidePromotion, type LevelSnapshot, type PromotionRow } from '@cmt/shared-domain';
import { buildLevelSnapshot } from './school-year';

interface MemberLite { mid: string; firstName: string; lastName: string; type: 'Adult' | 'Child'; schoolGrade: string | null; birthMonthYear: string | null; }
interface LevelLite { levelId: string; levelName: string; levelKind: 'shishu' | 'pre-level' | 'level' | 'parents'; gradeBand: string[]; }
export interface PlanInput { fid: string; location: string | null; enrolledMids: string[]; members: MemberLite[]; srcLevels: LevelLite[]; tgtLevels: LevelLite[]; now: Date; }
export interface FamilyPromotionPlan {
  fid: string;
  promotedMids: string[];
  gradeUpdates: { mid: string; schoolGrade: string }[];
  sourceSnapshots: Record<string, LevelSnapshot>;
  targetSnapshots: Record<string, LevelSnapshot>;
  rows: PromotionRow[];
}

export function planFamilyPromotion(input: PlanInput): FamilyPromotionPlan {
  const byMid = new Map(input.members.map((m) => [m.mid, m]));
  const plan: FamilyPromotionPlan = { fid: input.fid, promotedMids: [], gradeUpdates: [], sourceSnapshots: {}, targetSnapshots: {}, rows: [] };

  for (const mid of input.enrolledMids) {
    const m = byMid.get(mid);
    if (!m || m.type !== 'Child') continue; // BV enrolledMids are children
    const src = buildLevelSnapshot(m, input.srcLevels, input.now); // this-year snapshot (pre-advance)
    plan.sourceSnapshots[mid] = src;
    const outcome = decidePromotion(m, input.now);
    const row: PromotionRow = {
      fid: input.fid, mid, childName: `${m.firstName} ${m.lastName}`.trim(), location: input.location,
      outcomeKind: outcome.kind, fromGrade: src.schoolGrade, fromLevelName: src.levelName, toGrade: null, toLevelName: null,
    };
    if (outcome.kind === 'advance') {
      const advanced = { schoolGrade: m.schoolGrade == null ? outcome.to : outcome.to }; // canonical
      plan.gradeUpdates.push({ mid, schoolGrade: outcome.to });
      const tgt = buildLevelSnapshot({ schoolGrade: outcome.to, birthMonthYear: m.birthMonthYear }, input.tgtLevels, input.now);
      plan.targetSnapshots[mid] = tgt; plan.promotedMids.push(mid);
      row.toGrade = outcome.to; row.toLevelName = tgt.levelName;
    } else if (outcome.kind === 'shishu-stays') {
      const tgt = buildLevelSnapshot({ schoolGrade: null, birthMonthYear: m.birthMonthYear }, input.tgtLevels, input.now);
      plan.targetSnapshots[mid] = tgt; plan.promotedMids.push(mid);
      row.toGrade = null; row.toLevelName = tgt.levelName;
    }
    // graduate / shishu-aged-out / needs-grade → no promotion, no grade update; row records the kind.
    plan.rows.push(row);
  }
  return plan;
}
```

- [ ] **Step 3: Run** the test → PASS. tsc.
- [ ] **Step 4: Commit** `feat(rollover): pure planFamilyPromotion (N=2 safe; graduate/needs-grade flagged)`.

---

## Task 6: `promoteFamilies` engine (applier)

Find families, apply each plan in a per-family transaction (atomic + idempotent), aggregate the `RolloverReport`. Dry-run path computes without writing.

**Files:**
- Create: `apps/portal/src/features/setu/rollover/promote-families.ts`
- Create: `apps/portal/src/features/setu/rollover/__tests__/promote-families.test.ts`

- [ ] **Step 1: Write the failing test** (fake-firestore). Seed source levels (pid `bv-brampton-2025-26`) + target levels (pid `bv-brampton-2026-27`) + target offering, a family `F1` with members `F1-02` (Gr 2) + `F1-03` (Gr 3) + an active source enrollment `F1-bv-brampton-2025-26` (`enrolledMids:['F1-02','F1-03']`, `pid:'bv-brampton-2025-26'`). Assert after `promoteFamilies(db, { dryRun:false })`:
  - members advanced: `F1-02.schoolGrade==='3'`, `F1-03.schoolGrade==='4'`.
  - source enrollment `status==='cancelled'`, `cancelledReason==='promoted-2026-27'`, `levelSnapshots` has both mids' OLD grades/levels.
  - target enrollment `F1-bv-brampton-2026-27` exists, `status:'active'`, `pid:'bv-brampton-2026-27'`, `enrolledVia:'promotion'`, `enrolledMids:['F1-02','F1-03']`, `levelSnapshots['F1-03'].levelName==='Level 3'`.
  - report: `promoted:2, advanced:2, graduated:0, needsAttention:0`, `byTransition` includes `Level 2 → Level 2` (1) and `Level 2 → Level 3` (1).
  - **Idempotent re-run**: call again → `familiesSkippedAlreadyPromoted:1`, members NOT advanced again (still 3 and 4).
  - **dry-run**: on a fresh family, `promoteFamilies(db,{dryRun:true})` returns counts but writes nothing (source still active, no target).

Run → FAIL.

- [ ] **Step 2: Implement `promote-families.ts`:**

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount, type RolloverReport, type PromotionRow } from '@cmt/shared-domain';
import { BV_SOURCE_OIDS, DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, targetOidOf } from './school-year';
import { planFamilyPromotion } from './plan-family-promotion';

type Db = FirebaseFirestore.Firestore;
interface PromoteArgs { fromYear?: string; toYear?: string; actorMid?: string; dryRun: boolean; }

export async function promoteFamilies(db: Db, args: PromoteArgs): Promise<RolloverReport> {
  const fromYear = args.fromYear ?? DEFAULT_FROM_YEAR;
  const toYear = args.toYear ?? DEFAULT_TO_YEAR;
  const now = new Date();
  // 1. Load src + tgt levels grouped by sourceOid → { src: LevelLite[], tgt: LevelLite[], targetOid, location, offering }.
  //    (read levels where pid==sourceOid and pid==targetOid; read the target offering for suggestedAmount.)
  // 2. For each sourceOid: collectionGroup('enrollments').where('oid','==',sourceOid).where('status','==','active').
  //    For each enrollment doc → fid, enrolledMids.
  // 3. Per family: read members; planFamilyPromotion(...). Aggregate rows/counts.
  //    If dryRun → no writes. Else runTransaction(fid):
  //      - re-read target enrollment {fid}-{targetOid}; if exists & active → skip (familiesSkippedAlreadyPromoted++); return.
  //      - apply gradeUpdates: txn.set(memberRef, { schoolGrade }, { merge:true }) for each.
  //      - close source: txn.set(srcEnrollRef, { status:'cancelled', cancelledAt: serverTimestamp(), cancelledReason:`promoted-${toYear}`, levelSnapshots: sourceSnapshots }, { merge:true }).
  //      - if promotedMids.length: txn.set(tgtEnrollRef, { ...full doc..., pid: targetOid, enrolledVia:'promotion', enrolledMids: promotedMids, levelSnapshots: targetSnapshots, status:'active', enrolledAt: serverTimestamp(), suggestedAmountSnapshot: resolveSuggestedAmount(offering, now), suggestedAmountOverride:null, cancelledAt:null, cancelledReason:null, programKey, programLabel, termLabel: toYear, location, fid, oid: targetOid, eid: tgtEid, enrolledByMid: args.actorMid ?? null }).
  // 4. Aggregate report: promoted = sum promotedMids; advanced = rows advance; shishuStayed = rows shishu-stays;
  //    graduated = rows graduate; needsAttention = rows shishu-aged-out + needs-grade; byTransition grouped by `${fromLevelName ?? '—'} → ${toLevelName ?? (kind)}`.
  //    graduates = rows graduate; attention = rows shishu-aged-out|needs-grade; rows = full (dry-run) / capped (commit, e.g. first 500).
}
```

Implementation notes:
- Read levels/members with the same `toDate`/plain-data pattern as the backfill.
- Transaction rule: ALL reads before ANY writes. Read target enrollment + members first, then write.
- Member ref path: `families/{fid}/members/{mid}`.
- `byTransition` label for non-promoted rows: use the outcome kind label ("Graduating", "Needs attention") so the preview still accounts for everyone, OR exclude non-promoted from byTransition and surface them via the dedicated `graduates`/`attention` arrays. **Choose: byTransition only includes promoted rows** (advance + shishu-stays); graduates/attention have their own sections. Document this in a code comment.
- `exactOptionalPropertyTypes`: when building the target doc, always include every field (no conditional-undefined). `enrolledByMid: args.actorMid ?? null`.

- [ ] **Step 3: Run** the test → PASS. tsc + `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover`.
- [ ] **Step 4: Commit** `feat(rollover): promoteFamilies engine — per-family txn, idempotent, history-preserving`.

---

## Task 7: `enrollFamily` pid fix

**Files:**
- Modify: `apps/portal/src/features/setu/enrollment/enroll-family.ts`
- Modify/Create the matching test (find the existing enroll-family test; if none, create `__tests__/enroll-family.test.ts`).

- [ ] **Step 1: Add/adjust a test** asserting the written enrollment doc includes `pid: oid` (use the existing test harness/mocks for this module if present; otherwise a fake-firestore test seeding an offering + family + a child member, then asserting the doc).
- [ ] **Step 2: Implement** — in the `txn.set(enrollmentRef, { … })` object (`enroll-family.ts:129`), add `pid: oid,` right after `oid,`.
- [ ] **Step 3: Run** the enroll-family + enrollment-route tests → PASS. tsc.
- [ ] **Step 4: Commit** `fix(enrollment): write pid:oid so portal-initiated enrollments appear on teacher rosters`.

---

## Task 8: API routes — `POST /api/admin/school-year/{start,promote}`

**Files:**
- Create: `apps/portal/src/app/api/admin/school-year/start/route.ts`
- Create: `apps/portal/src/app/api/admin/school-year/promote/route.ts`
- Create: `apps/portal/src/app/api/admin/school-year/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing route tests** — mock `next/cache` `revalidateTag` (known harness quirk), mock the engine module + session reader. Assert: non-admin → 403; admin + `start` → calls `startNewYear`, returns `StartYearResult` JSON; admin + `promote {dryRun:true}` → calls `promoteFamilies({dryRun:true})`, returns report; bad body → 400. Run → FAIL.

- [ ] **Step 2: Implement** both routes. Pattern (mirror an existing `/api/admin/*` route, e.g. `offerings/route.ts`):

```ts
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { readSessionFromHeaders } from '@/features/setu/auth/session'; // verify exact path/name
import { isAdmin } from '@cmt/shared-domain';
import { StartYearBodySchema } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { startNewYear } from '@/features/setu/rollover/start-new-year';

export async function POST(req: Request) {
  const session = await readSessionFromHeaders();
  if (!session || !isAdmin(session.claims)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = StartYearBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const result = await startNewYear(portalFirestore(), { ...body.data, actorMid: session.claims.mid ?? 'admin', dryRun: false });
  revalidateTag('offerings'); revalidateTag('levels');
  return NextResponse.json(result);
}
```

- `promote/route.ts`: same shape with `PromoteBodySchema`; on `dryRun:false` also `revalidateTag` enrollment/roster/dashboard tags (grep existing tag names — e.g. `enrollments`, `teacher-roster`). Verify the exact `readSessionFromHeaders` import + `session.claims` shape against an existing admin route; use `isAdmin` helper (never `=== 'admin'`).
- `canAccessRoute`: `/api/admin/` catch-all already gates admin-only — **verify** in `can-access-route.ts` and add a test asserting a non-admin family role is denied `/api/admin/school-year/promote` (middleware-level), if that suite exists.

- [ ] **Step 3: Run** route tests → PASS. tsc + lint.
- [ ] **Step 4: Commit** `feat(api): admin school-year start + promote routes (admin-gated, mobile-ready JSON)`.

---

## Task 9: Client fetch wrappers

**Files:**
- Create: `apps/portal/src/features/setu/rollover/rollover-client.ts`

- [ ] **Step 1:** Implement thin wrappers that POST to the two routes and `RolloverReportSchema`/`StartYearResultSchema`-parse the response; **throw on non-OK** so the UI fires an error toast (per the welcome-search precedent):

```ts
'use client';
import { RolloverReportSchema, StartYearResultSchema, type RolloverReport, type StartYearResult } from '@cmt/shared-domain';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}
export async function startNewYearClient(): Promise<StartYearResult> {
  return StartYearResultSchema.parse(await postJson('/api/admin/school-year/start', {}));
}
export async function previewPromotionClient(): Promise<RolloverReport> {
  return RolloverReportSchema.parse(await postJson('/api/admin/school-year/promote', { dryRun: true }));
}
export async function commitPromotionClient(): Promise<RolloverReport> {
  return RolloverReportSchema.parse(await postJson('/api/admin/school-year/promote', { dryRun: false }));
}
```

- [ ] **Step 2:** tsc + lint. **Commit** `feat(rollover): client fetch wrappers (parse + throw on non-OK)`.

---

## Task 10: Admin rollover page UI + tile (designer pass required)

Build the guided two-step page from spec §8.2 — web **and** real mobile layout. Use Setu `.csp` tokens; this is a polished, intuitive surface.

**Files:**
- Create: `apps/portal/src/app/admin/school-year/page.tsx` (server: reads current state — does the target year exist? — and renders the client `RolloverPage`)
- Create: `apps/portal/src/app/admin/school-year/error.tsx`
- Create: `apps/portal/src/features/setu/rollover/components/rollover-page.tsx` (client; owns step state + toasts)
- Create: `start-step.tsx`, `promote-step.tsx`, `promotion-preview.tsx`, `confirm-dialog.tsx`
- Create: `apps/portal/src/features/setu/rollover/components/__tests__/rollover-ui.test.tsx`
- Modify: `apps/portal/src/app/admin/page.tsx` (add the tile)

- [ ] **Step 1: Write failing component tests** (Testing Library): RolloverPage renders Step 1 + Step 2; Step 2's primary action is disabled until `nextYearReady`; clicking "Preview run" calls `previewPromotionClient` (mocked) and renders the three counts + a `byTransition` row + an attention row with a "Fix →" link to `/family/members/<mid>/edit`; the confirm dialog appears before commit and "Promote" calls `commitPromotionClient`. Mock `rollover-client`. Run → FAIL.

- [ ] **Step 2: Implement the page + components.** Requirements (match the wireframes in spec §8.2 + §8.3):
  - **Header**: "School Year Rollover" + an Active-year → Next-year status row (Next year shows ● Not started / ● Ready).
  - **Step 1 card** (`start-step.tsx`): explainer copy + counts ("18 levels, 2 offerings to create" — derive from a server prop) + "Start 2026-27" button → `startNewYearClient`; success flips to a green confirmed state + "Re-sync" link; on success, unlock Step 2.
  - **Step 2 card** (`promote-step.tsx`): locked (greyed, explanatory) until `nextYearReady`. "Preview run" → `previewPromotionClient` → render `promotion-preview.tsx`.
  - **`promotion-preview.tsx`**: three big stat cards (moving up / graduate / need attention) with a `(incl. N Shishu continuing)` subnote; a "Where students move" list from `byTransition` (label + count + a proportional bar); collapsible **Graduating** + **Need attention** sections; each attention row links `Fix →` to the child edit screen. A primary "Promote N students →" button opens `confirm-dialog.tsx`.
  - **`confirm-dialog.tsx`**: `.csp`-scoped (it's an overlay — must carry the class or be inside CspRoot), copy from spec, Confirm → `commitPromotionClient` → result state ("N promoted · M graduated · K skipped" + "View 2026-27 rosters →" + "Re-run preview").
  - **Toasts** via the existing Sonner setup for success/error (throw-on-non-OK from the client).
  - **Mobile**: a genuine `block md:hidden` layout — cards stack, stat trio fits without horizontal scroll, transition list becomes stacked rows, buttons full-width. Do not ship a desktop-only grid.
  - **Tile**: add to `admin/page.tsx` a `<Tile href="/admin/school-year" title="School year rollover" icon="check" sub="Promote Bala Vihar families to the next school year — advance grades, re-assign levels, keep each child's history." tone="primary" />` (pick an existing icon name).
  - Reuse existing Setu primitives (buttons, cards) rather than new ones; match `/admin/levels` / welcome dashboard styling.

- [ ] **Step 3: Run** the UI tests → PASS. tsc + lint + `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover`.
- [ ] **Step 4: Designer pass** — dispatch the designer agent (Opus) to refine spacing, hierarchy, color, motion, and the mobile layout against the spec wireframes; apply its changes; re-run tests.
- [ ] **Step 5: Commit** `feat(admin): school-year rollover page — guided 2-step flow + dry-run preview (web+mobile)`.

---

## Task 11: Child-profile "Bala Vihar journey" strip

**Files:**
- Create: `apps/portal/src/features/setu/rollover/get-child-journey.ts` (+ test)
- Create: `apps/portal/src/features/setu/rollover/components/journey-strip.tsx` (+ test)
- Modify: `apps/portal/src/app/family/members/[mid]/page.tsx`
- Modify: the welcome read-only child detail page (find it: `apps/portal/src/app/welcome/family/[fid]/...`).

- [ ] **Step 1: Write the failing test** for `get-child-journey.ts`: given a child's enrollments (each with `termLabel` + `levelSnapshots[mid]` + `status`), returns rows sorted by `termLabel` **desc** with `{ termLabel, schoolGrade, levelName, active }` (active = `status==='active'`). Include an N=2 case (two years) and a graduate (latest year cancelled, no active). Run → FAIL.
- [ ] **Step 2: Implement** `get-child-journey.ts` — read `families/{fid}/enrollments` where `enrolledMids` array-contains `mid` (or filter in memory), map each to a journey row from `levelSnapshots[mid]`, sort desc by `termLabel`. (No index needed if filtering the family's own enrollments subcollection in memory.)
- [ ] **Step 3: Implement** `journey-strip.tsx` (spec §8.3 wireframe): a compact themed list, "Active" vs "Completed" badge, empty state ("No Bala Vihar history yet"). Mobile-friendly (stacks naturally). Add a component test.
- [ ] **Step 4: Wire** into the member page + welcome detail (pass `fid` + `mid`; render under the existing profile sections). Keep the welcome detail's defensive role re-check intact.
- [ ] **Step 5: Run** tests → PASS. tsc + lint.
- [ ] **Step 6: Commit** `feat(family): Bala Vihar journey strip on child profile (reads levelSnapshots)`.

---

## Task 12: CLI parity scripts + pnpm aliases

**Files:**
- Create: `apps/portal/scripts/start-new-year.ts`
- Create: `apps/portal/scripts/promote-families.ts`
- Modify: `apps/portal/package.json` (aliases)

- [ ] **Step 1: Implement** both scripts mirroring `backfill-bv-enrollments.ts` structure exactly: arg parser (`--dry-run`, `--from`, `--to`, `--limit`, `--fid`, `--allow-prod`), the **UAT guard** (refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'` without `--allow-prod`), call `startNewYear` / `promoteFamilies` with `portalFirestore()`, print a readable summary (counts, per-transition, attention list). `promote-families.ts` honors `--dry-run` → `promoteFamilies({ dryRun:true })`. `--limit`/`--fid` filter the families processed (pass through to the engine or filter the collectionGroup result — simplest: add optional `limit`/`fidFilter` to the engine args).
- [ ] **Step 2: Add aliases** to `apps/portal/package.json` scripts:
```json
"school-year:start": "tsx --env-file=.env.local scripts/start-new-year.ts",
"school-year:promote": "tsx --env-file=.env.local scripts/promote-families.ts",
```
- [ ] **Step 3:** Isolated tsc for the scripts (`pnpm --filter @cmt/portal exec tsc --noEmit`) + lint. **Do NOT run them** (they hit UAT) — leave execution to the controller's verification step.
- [ ] **Step 4: Commit** `feat(scripts): school-year:start + school-year:promote CLI (UAT-guarded, dry-run)`.

---

## Task 13: Firestore collectionGroup index

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 1:** Add a collectionGroup composite index on `enrollments`:
```json
{
  "collectionGroup": "enrollments",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "oid", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```
(Match the file's existing array shape/placement.)
- [ ] **Step 2:** Validate JSON (`node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`).
- [ ] **Step 3: Commit** `chore(firestore): collectionGroup index enrollments(oid,status) for rollover`.
- [ ] **Step 4 (controller, deploy):** `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` — **NO `--force`**, **UAT only** (never prod `chinmaya-setu-715b8`).

---

## Final controller steps (after all tasks)

1. Full gate: `pnpm --filter @cmt/portal exec tsc --noEmit && pnpm --filter @cmt/portal lint && pnpm --filter @cmt/portal test` green; push (pre-push runs typecheck+lint+test+build).
2. Deploy the index to UAT (Task 13 step 4).
3. **UAT walkthrough (mock-free, per spec §12):** Start 2026-27 → confirm levels/offerings; Preview → counts ≈ 512 families, spot-check a Brampton Level 2 split + a Scarborough level + graduates + attention; Commit → re-open a promoted family (new grade/level + journey strip Active/Completed), 2026-27 teacher roster shows promoted kids, 2025-26 roster doesn't; Re-run preview → 0 to advance (idempotency proven).
4. Dispatch a final code-reviewer over the whole branch; address findings.
5. Summary states plainly which steps were UAT-verified vs unit-tested-only.

---

## Self-Review (filled before execution)

**Spec coverage:** ✅ Start-new-year (T4) · grade ladder & two-grades-per-level (T2/T5) · history snapshots (T1/T5/T11) · one-click + dry-run + confirm UI (T10) · mobile + API-first (T8/T9/T10/T11) · graduate/shishu/needs-grade edges (T2/T5) · `pid` invariant (T1/T6/T7) · index (T13) · CLI parity (T12) · child-profile journey (T11).

**Placeholder scan:** Engine bodies in T4/T6 are given as annotated algorithm comments rather than full line-by-line code — deliberate, because the load-bearing logic (ladder, planner, snapshot) is fully written in T2/T3/T5 and the engines are mechanical Firestore plumbing over those pure functions. Implementers have the backfill (`enroll-family.ts` + `backfill-bv-enrollments.ts`) as verbatim patterns. Acceptable for subagent-driven execution; not a vague "add error handling".

**Type consistency:** `RolloverReport`/`StartYearResult`/`PromotionRow`/`LevelSnapshot` defined once in T1, imported everywhere. `decidePromotion` outcome kinds match across ladder (T2), planner (T5), engine aggregation (T6), and UI (T10). `targetOidOf`/`buildLevelSnapshot` signatures stable T3→T5→T6.

**Open items for implementers to verify (called out inline):** exact `readSessionFromHeaders` import + `session.claims.mid` shape; `toSafeSlug` package-root export; existing revalidate tag names; the welcome child-detail file path; an existing icon name for the tile; the existing enroll-family test location.
