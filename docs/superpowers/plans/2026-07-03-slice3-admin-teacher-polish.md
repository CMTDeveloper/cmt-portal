# Slice 3 — Admin / Teacher Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Bala Vihar admin/teacher surfaces — grade dropdowns from one canonical source, per-level inline teacher assignment, binary Present/Absent attendance, guest-add grade dropdown, and a rollover teacher-carry-forward fix.

**Architecture:** Refinements to existing Next.js 16 App Router screens + `/api/admin/*` and `/api/setu/*` route handlers, backed by pure `@cmt/shared-domain` helpers. One new canonical grade source in shared-domain feeds every grade `<select>`. Two bug fixes (level-name collision, rollover-empty teachers) begin with a read-only UAT reproduction. No new Firestore composite indexes; no new feature flag.

**Tech Stack:** TypeScript, Next.js 16 (RSC + `cacheComponents`), Firebase Admin (Firestore), Zod, Vitest (unit/integration), Playwright (deployed-UAT E2E), Turborepo/pnpm.

**Spec:** `docs/superpowers/specs/2026-07-03-slice3-admin-teacher-polish-design.md`

## Global Constraints

- **UAT only** — all DB ops / index checks / E2E target `chinmaya-setu-uat`; never touch prod `715b8`; never `--force` an index deploy.
- **`@cmt/shared-domain` stays pure** — no React/Next/Firestore imports; new grade consts + `levelGradeSummary()` live there as pure TS.
- **`exactOptionalPropertyTypes` is ON** — never assign `undefined` to an optional; omit the key or use `null`.
- **Doc-read schemas validate on read** — never narrow a stored-doc field's enum in a way that rejects historical values (`late`, `uninformed`); enforce narrowing only at write routes/forms.
- **Role checks via helpers** — `isAdmin` / `isWelcomeTeam` / `isTeacher`, never `role === …`.
- **canAccessRoute** — every new `/api/**` path gets an explicit rule; new `/api/admin/*` teacher rules go BEFORE the `/api/admin/` admin-only catch-all (line ~42).
- **No new Firestore composite indexes** — bulk `collectionGroup` reads + in-memory joins/filters.
- **Mobile contract** — any `/api/setu/**` request/response/enum change appends a dated, SHA-keyed `apps/portal/docs/MOBILE_API_CHANGELOG.md` entry. `/api/admin/*` is NOT part of the mobile contract.
- **Every user-facing surface gets a deployed-UAT Playwright E2E** (Task 13) — WRITE the specs here; RUN them at the owner UAT gate after deploy.
- **Runbook** — Task 13 adds a dated §14 entry for any UAT-visible behavior change.
- **Canonical grade set (owner table 2026-07-03):** Shishu (age 1.5–4, age-based) · Pre-Level = JK/SK · Levels 1–7 = Gr 1…12 · Parents = All Adults. Grade tokens = `GRADE_LADDER = [JK, SK, 1…12]` + `Shishu`. **No `3K`.** `GRADE_LADDER` and promotion are untouched.
- **N=2 discipline** — exercise every one→many read (multiple teachers per level, multiple levels per teacher, a historical `late` event) with two instances.
- **Commit author** is `CMT Developer <developer@chinmayatoronto.org>` (local git config). Never `--no-verify`.

---

## Task 1: Canonical grade options + `levelGradeSummary` + optional `ageLabel`

**Files:**
- Create: `packages/shared-domain/src/setu/grades.ts`
- Create: `packages/shared-domain/src/setu/__tests__/grades.test.ts`
- Modify: `packages/shared-domain/src/setu/schemas/level.ts` (add `levelGradeSummary`; make `ageLabel` optional in `LevelDocSchema`/`CreateLevelSchema`/`UpdateLevelSchema`)
- Modify: `packages/shared-domain/src/setu/schemas/__tests__/level.test.ts` (or the nearest existing level test file — add `levelGradeSummary` cases)
- Modify: `packages/shared-domain/src/index.ts` (export the new module — confirm the barrel path used by `@cmt/shared-domain`)

**Interfaces:**
- Produces:
  - `GRADE_BAND_OPTIONS: readonly {value:string;label:string}[]` — `[{JK},{SK},{Grade 1}…{Grade 12}]`
  - `CHILD_GRADE_OPTIONS: readonly {value:string;label:string}[]` — `[{Shishu…}, ...GRADE_BAND_OPTIONS]`
  - `levelGradeSummary(level: Pick<LevelDoc,'levelKind'|'gradeBand'>): string`
  - `LevelDoc.ageLabel` becomes `string | undefined` (optional).

- [ ] **Step 1: Write the failing test for the grade option lists**

Create `packages/shared-domain/src/setu/__tests__/grades.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GRADE_BAND_OPTIONS, CHILD_GRADE_OPTIONS } from '../grades';

describe('grade options', () => {
  it('GRADE_BAND_OPTIONS is JK, SK, then Grade 1..12 in order (no Shishu, no 3K)', () => {
    expect(GRADE_BAND_OPTIONS.map((o) => o.value)).toEqual([
      'JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ]);
    expect(GRADE_BAND_OPTIONS.find((o) => o.value === '1')?.label).toBe('Grade 1');
    expect(GRADE_BAND_OPTIONS.find((o) => o.value === 'JK')?.label).toBe('JK');
  });

  it('CHILD_GRADE_OPTIONS prepends the Shishu age bucket', () => {
    expect(CHILD_GRADE_OPTIONS[0]).toEqual({ value: 'Shishu', label: 'Shishu (younger than JK)' });
    expect(CHILD_GRADE_OPTIONS.map((o) => o.value)).toEqual(['Shishu', ...GRADE_BAND_OPTIONS.map((o) => o.value)]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @cmt/shared-domain test -- grades`
Expected: FAIL — cannot find module `../grades`.

- [ ] **Step 3: Create the grades module**

Create `packages/shared-domain/src/setu/grades.ts`:

```ts
import { GRADE_LADDER } from './grade-ladder';

// The single canonical source for EVERY grade dropdown (owner's Bala Vihar level
// table, 2026-07-03). No '3K': the youngest tier is the age-based Shishu bucket.

/** Individual grade tokens an admin ticks to build a level's gradeBand
 *  (pre-level / level kinds). Labels follow the table: "JK", "SK", "Grade 1"… */
export const GRADE_BAND_OPTIONS: readonly { value: string; label: string }[] =
  GRADE_LADDER.map((g) => ({ value: g, label: /^\d/.test(g) ? `Grade ${g}` : g }));

/** Grades a CHILD can be in — the band tokens plus the age-based Shishu bucket
 *  (younger than JK). Used by the child profile + guest-add pickers. */
export const CHILD_GRADE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'Shishu', label: 'Shishu (younger than JK)' },
  ...GRADE_BAND_OPTIONS,
];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @cmt/shared-domain test -- grades`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `levelGradeSummary`**

Add to the level schema test file (`packages/shared-domain/src/setu/schemas/__tests__/level.test.ts`; if it does not exist, create it with the standard vitest imports):

```ts
import { levelGradeSummary } from '../level';

describe('levelGradeSummary — reproduces the table AGE/GRADE column', () => {
  it('shishu → fixed age range', () => {
    expect(levelGradeSummary({ levelKind: 'shishu', gradeBand: [] })).toBe('1.5 to 4 years');
  });
  it('parents → All Adults', () => {
    expect(levelGradeSummary({ levelKind: 'parents', gradeBand: [] })).toBe('All Adults');
  });
  it('pre-level [JK,SK] → "JK / SK"', () => {
    expect(levelGradeSummary({ levelKind: 'pre-level', gradeBand: ['JK', 'SK'] })).toBe('JK / SK');
  });
  it('level single grade → "Gr 1"', () => {
    expect(levelGradeSummary({ levelKind: 'level', gradeBand: ['1'] })).toBe('Gr 1');
  });
  it('level contiguous pair → "Gr 2 & 3"', () => {
    expect(levelGradeSummary({ levelKind: 'level', gradeBand: ['2', '3'] })).toBe('Gr 2 & 3');
  });
  it('level contiguous run of 3+ → "Gr 9 to 12"', () => {
    expect(levelGradeSummary({ levelKind: 'level', gradeBand: ['9', '10', '11', '12'] })).toBe('Gr 9 to 12');
  });
  it('level non-contiguous → comma list "Gr 2, 5"', () => {
    expect(levelGradeSummary({ levelKind: 'level', gradeBand: ['2', '5'] })).toBe('Gr 2, 5');
  });
  it('level with an empty band → "Grade" (defensive, never happens for a valid level)', () => {
    expect(levelGradeSummary({ levelKind: 'level', gradeBand: [] })).toBe('Grade');
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `pnpm --filter @cmt/shared-domain test -- level`
Expected: FAIL — `levelGradeSummary` is not exported.

- [ ] **Step 7: Implement `levelGradeSummary` in `schemas/level.ts`**

Add to `packages/shared-domain/src/setu/schemas/level.ts` (after `normalizeGrade`), using the existing `GRADE_LADDER` order for contiguity. Import `GRADE_LADDER` at the top (note: `grade-ladder.ts` imports from `./schemas/level`, so to avoid a circular import, inline the ladder order here rather than importing it):

```ts
// Ladder order for grade-band summaries (JK, SK, 1..12) — inlined to avoid a
// cycle with grade-ladder.ts (which imports from this file).
const GRADE_ORDER = ['JK', 'SK', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/**
 * Human display label for a level, derived from kind + gradeBand — reproduces the
 * owner's Bala Vihar AGE/GRADE column and replaces the removed free-text ageLabel.
 *   shishu → "1.5 to 4 years"   parents → "All Adults"
 *   pre-level → "JK / SK"       level → "Gr 1" | "Gr 2 & 3" | "Gr 9 to 12" | "Gr 2, 5"
 */
export function levelGradeSummary(level: Pick<LevelDoc, 'levelKind' | 'gradeBand'>): string {
  if (level.levelKind === 'shishu') return '1.5 to 4 years';
  if (level.levelKind === 'parents') return 'All Adults';

  const band = level.gradeBand;
  if (level.levelKind === 'pre-level') return band.join(' / ') || 'JK / SK';

  // level kind → "Gr …"
  if (band.length === 0) return 'Grade';
  const ordered = [...band].sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  // Contiguous run in ladder order → range; a pair → "&"; else comma list.
  const idxs = ordered.map((g) => GRADE_ORDER.indexOf(g));
  const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1]! + 1) && idxs.every((v) => v >= 0);
  if (contiguous && ordered.length >= 3) return `Gr ${ordered[0]} to ${ordered[ordered.length - 1]}`;
  if (ordered.length === 2) return `Gr ${ordered[0]} & ${ordered[1]}`;
  return `Gr ${ordered.join(', ')}`;
}
```

- [ ] **Step 8: Make `ageLabel` optional in the three level schemas**

In `packages/shared-domain/src/setu/schemas/level.ts`:
- `LevelDocSchema`: change `ageLabel: z.string().min(1),` → `ageLabel: z.string().min(1).optional(),`
- `CreateLevelSchema`: change `ageLabel: z.string().min(1),` → `ageLabel: z.string().min(1).optional(),`
- `UpdateLevelSchema`: `ageLabel` is already `.optional()` — leave it.

- [ ] **Step 9: Run the full shared-domain suite**

Run: `pnpm --filter @cmt/shared-domain test`
Expected: PASS (new grade + summary tests green; existing level/grade-ladder tests unaffected). If a barrel export is missing, add `export * from './setu/grades';` to the shared-domain index used by consumers and re-run.

- [ ] **Step 10: Typecheck + commit**

Run: `pnpm --filter @cmt/shared-domain typecheck`
```bash
git add packages/shared-domain/src/setu/grades.ts packages/shared-domain/src/setu/__tests__/grades.test.ts packages/shared-domain/src/setu/schemas/level.ts packages/shared-domain/src/setu/schemas/__tests__/level.test.ts packages/shared-domain/src/index.ts
git commit -m "feat(slice3): canonical grade options + levelGradeSummary; ageLabel optional"
```

---

## Task 2: Level modal — grade multi-select dropdown; remove age field; child form single-source

**Files:**
- Modify: `apps/portal/src/features/admin/levels/levels-table.tsx` (the `LevelModal`)
- Modify: `apps/portal/src/features/setu/members/complete-profile-form.tsx` (delete local `GRADE_OPTIONS`, import `CHILD_GRADE_OPTIONS`)
- Modify: `apps/portal/src/features/admin/levels/__tests__/*` (adjust any modal test asserting the ageLabel input / free-text grade — align to the new controls)

**Interfaces:**
- Consumes: `GRADE_BAND_OPTIONS`, `CHILD_GRADE_OPTIONS` (Task 1).
- The modal no longer sends `ageLabel` on create/update. `gradeBand` is chosen from checkboxes.

- [ ] **Step 1: Replace the free-text grade input with a multi-select in `LevelModal`**

In `levels-table.tsx`, import at top: add `GRADE_BAND_OPTIONS` to the `@cmt/shared-domain` import. Replace the grade `<input>` block (the `label` containing `value={gradeBand} onChange={... setGradeBand ...}`) with a checkbox group driven by the current `gradeBand` string state. Keep the existing `parseBand`/join round-trip by storing the band as a `string[]` in state instead of a comma string:

- Change `const [gradeBand, setGradeBand] = useState((editing?.gradeBand ?? []).join(', '));`
  → `const [gradeBand, setGradeBand] = useState<string[]>(editing?.gradeBand ?? []);`
- Replace `const band = bandNeedsGrades(levelKind) ? parseBand(gradeBand) : [];` (in `handleSubmit`)
  → `const band = bandNeedsGrades(levelKind) ? gradeBand : [];`
- Replace the diff-check `if (JSON.stringify(band) !== JSON.stringify(editing.gradeBand)) body.gradeBand = band;` — unchanged (still compares arrays).
- Replace the validation `if (bandNeedsGrades(levelKind) && parseBand(gradeBand).length === 0)` → `if (bandNeedsGrades(levelKind) && gradeBand.length === 0)`.
- Delete the now-unused `parseBand` helper.
- Replace the grade `<label>…<input …/></label>` JSX with:

```tsx
<div style={labelStyle}>
  Grades {bandNeedsGrades(levelKind) ? '' : '(not used for this kind)'}
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, opacity: bandNeedsGrades(levelKind) ? 1 : 0.5 }}>
    {GRADE_BAND_OPTIONS.map((g) => {
      const checked = gradeBand.includes(g.value);
      return (
        <label key={g.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400, textTransform: 'none', letterSpacing: 0, cursor: bandNeedsGrades(levelKind) ? 'pointer' : 'default', padding: '4px 10px', borderRadius: 999, border: `1px solid ${checked ? 'var(--accent)' : 'var(--line2)'}`, background: checked ? 'var(--accentSoft)' : 'var(--bg)', color: checked ? 'var(--accentDeep)' : 'var(--body-text)' }}>
          <input
            type="checkbox"
            checked={checked}
            disabled={!bandNeedsGrades(levelKind)}
            onChange={() =>
              setGradeBand((prev) => (prev.includes(g.value) ? prev.filter((v) => v !== g.value) : [...prev, g.value]))
            }
            style={{ accentColor: 'var(--accent)' }}
          />
          {g.label}
        </label>
      );
    })}
  </div>
  {errors.gradeBand && <FieldError msg={errors.gradeBand} />}
</div>
```

- [ ] **Step 2: Remove the "Age / grade label" field from `LevelModal`**

In `levels-table.tsx`:
- Delete `const [ageLabel, setAgeLabel] = useState(editing?.ageLabel ?? '');`
- Delete the validation line `if (!ageLabel.trim()) e.ageLabel = 'Required';`
- Delete the update-diff line `if (ageLabel !== editing.ageLabel) body.ageLabel = ageLabel;`
- In the create `body: CreateLevelInput`, delete the `ageLabel,` field.
- In the `onSaved({...})` call, delete `ageLabel,` (the `LevelRow` `ageLabel` becomes derived — see Task 3; set it to `undefined` there is not allowed under exactOptionalPropertyTypes, so simply OMIT the key).
- Delete the entire `<label>Age / grade label …</label>` JSX block (the input with `placeholder="Grade 2 & 3"`).

Note: `LevelRow = Omit<LevelDoc,'createdAt'|'updatedAt'> & {…}` — since `LevelDoc.ageLabel` is now optional, `LevelRow.ageLabel?` is optional; omitting it in `onSaved` is valid.

- [ ] **Step 3: Point the child profile form at the single source**

In `apps/portal/src/features/setu/members/complete-profile-form.tsx`:
- Delete the local `const GRADE_OPTIONS = [...]` block (lines defining Shishu + GRADE_LADDER map).
- Remove `GRADE_LADDER` from the `@cmt/shared-domain` import if it's now unused; add `CHILD_GRADE_OPTIONS`.
- Where the form maps `GRADE_OPTIONS.map(...)` (≈ line 541), change to `CHILD_GRADE_OPTIONS.map(...)`.

- [ ] **Step 4: Run the affected unit tests**

Run: `pnpm --filter @cmt/portal test -- levels-table complete-profile`
Expected: PASS after aligning any test that asserted the removed ageLabel input or the old comma grade field. If a test types a comma grade string, update it to select checkboxes (or assert `gradeBand` array state).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @cmt/portal typecheck`
```bash
git add apps/portal/src/features/admin/levels/levels-table.tsx apps/portal/src/features/setu/members/complete-profile-form.tsx apps/portal/src/features/admin/levels/__tests__
git commit -m "feat(slice3): level grade multi-select dropdown; remove free-text age field; child form uses CHILD_GRADE_OPTIONS"
```

---

## Task 3: Derive the level display label via `levelGradeSummary` everywhere `ageLabel` was shown

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/roster.ts` (`buildRoster` — derive `ageLabel`)
- Modify: `apps/portal/src/features/setu/teacher/visitors.ts:89`
- Modify: `apps/portal/src/app/teacher/page.tsx:45`
- Modify: `apps/portal/src/app/welcome/levels/page.tsx:45`
- Modify: `apps/portal/src/features/admin/levels/levels-table.tsx` (table + card display of grade)
- Test: `apps/portal/src/features/setu/teacher/__tests__/roster.test.ts` (assert derived `ageLabel`)

**Interfaces:**
- Consumes: `levelGradeSummary` (Task 1). All display of a level's age/grade now flows through it; the stored `ageLabel` is no longer read for display.

- [ ] **Step 1: Derive `ageLabel` in `buildRoster`**

In `roster.ts`:
- Add `levelGradeSummary` to the `@cmt/shared-domain` import.
- Change the `buildRoster` `level` param `Pick<LevelDoc, 'levelId' | 'levelName' | 'ageLabel' | 'location' | 'pid' | 'levelKind' | 'gradeBand'>` → drop `'ageLabel'` (keep `levelKind`, `gradeBand`).
- In the returned `RosterResult`, change `ageLabel: level.ageLabel,` → `ageLabel: levelGradeSummary(level),`.

- [ ] **Step 2: Update the roster test to assert the derived label**

In `roster.test.ts`, for a `level` fixture with `levelKind:'level', gradeBand:['2','3']`, assert `result.ageLabel === 'Gr 2 & 3'` (drop any assertion reading a stored `ageLabel`). Ensure the fixture has **two** enrolled matching children (N=2).

- [ ] **Step 3: Run it (red → green)**

Run: `pnpm --filter @cmt/portal test -- roster`
Expected: PASS.

- [ ] **Step 4: Derive at the other display/producer sites**

- `visitors.ts:89` — add `levelGradeSummary` import; change `ageLabel: level.ageLabel,` → `ageLabel: levelGradeSummary(level),`.
- `app/teacher/page.tsx:45` — add `import { levelGradeSummary } from '@cmt/shared-domain';`; change `{l.location} · {l.ageLabel} · {l.curriculum}` → `{l.location} · {levelGradeSummary(l)} · {l.curriculum}`.
- `app/welcome/levels/page.tsx:45` — same import; change `{l.ageLabel} · {l.curriculum} · …` → `{levelGradeSummary(l)} · {l.curriculum} · …`.
- `levels-table.tsx` — the desktop table + mobile card currently render `l.gradeBand.join(', ')` under "Grades". Leave those (they show the raw band). No ageLabel column exists in the table, so nothing else to change here for display.

(The `welcome/levels/[levelId]/page.tsx:39` reads `roster.ageLabel`, which is now the derived value from Step 1 — no change needed. `level-attendance-view.ts:75` passes through `roster.ageLabel` — no change. The Setu attendance-marker header shows the passed `ageLabel` prop — now derived — no change.)

- [ ] **Step 5: Run the teacher/welcome tests + typecheck**

Run: `pnpm --filter @cmt/portal test -- roster visitors && pnpm --filter @cmt/portal typecheck`
Expected: PASS. `buildRoster` callers no longer pass `ageLabel` — confirm `deriveRoster` (same file) still compiles (it passes the full `level` object, which satisfies the narrowed Pick).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/teacher/roster.ts apps/portal/src/features/setu/teacher/visitors.ts apps/portal/src/app/teacher/page.tsx apps/portal/src/app/welcome/levels/page.tsx apps/portal/src/features/setu/teacher/__tests__/roster.test.ts
git commit -m "feat(slice3): derive level age/grade label via levelGradeSummary (retire ageLabel display)"
```

---

## Task 4: Fix the level-name collision bug (reproduce first)

**Files:**
- Modify: `apps/portal/src/app/api/admin/levels/route.ts` (POST — name uniqueness within location+pid)
- Modify: `apps/portal/src/app/api/admin/levels/[levelId]/route.ts` (PATCH — reject rename that collides)
- Create: `apps/portal/src/features/setu/teacher/level-name-conflict.ts` (shared helper)
- Create: `apps/portal/src/features/setu/teacher/__tests__/level-name-conflict.test.ts`
- Test: `apps/portal/src/app/api/admin/levels/__tests__/route.test.ts` + `[levelId]/__tests__/route.test.ts` (collision cases)

**Interfaces:**
- Produces: `async function findNameConflict(db, { location, pid, normalizedName, exceptLevelId? }): Promise<string | null>` — returns the conflicting `levelId` or `null`. Uses a single `where('pid','==',pid)` read (no composite index) + in-memory location + normalized-name compare.

- [ ] **Step 1: REPRODUCE in UAT (read-only) — confirm the symptom**

Per the firm project directive and `reproducing-setu-bugs-in-uat` skill, before writing the fix: read the two admin level routes and confirm the exact collision the owner hit. Write a throwaway script that lists UAT levels for a location+pid and checks for two docs whose `levelName` normalizes equal (the frozen-doc-id rename case), OR attempts the reported action:

```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local /tmp/repro-level-collision.ts
```
In the script, read `levels` where `pid == <a-live-bv-pid>`, print `{levelId, levelName, location}`, and flag any two with the same normalized name at the same location. Capture the actual behavior (duplicate-after-rename vs blocked-create). Record the confirmed symptom in the task report; if it differs from the frozen-id-rename hypothesis, adjust the fix accordingly. Delete the throwaway script when done.

- [ ] **Step 2: Write the failing unit test for `findNameConflict`**

Create `level-name-conflict.test.ts` (fake-firestore, following the pattern in the existing admin/levels route tests):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
// import the project's fake firestore harness used by other route tests
import { findNameConflict } from '../level-name-conflict';

// Seed two Brampton levels in pid 'bv-brampton-2025-26': "Level 2" and "Level 3".
// (Set up via the same fake-firestore helper the sibling tests use.)

describe('findNameConflict', () => {
  it('returns the conflicting levelId when a name normalizes-equal within (location, pid)', async () => {
    // creating another "level 2" (case/space-insensitive) at Brampton → conflict
    expect(await findNameConflict(db, { location: 'Brampton', pid: 'bv-brampton-2025-26', normalizedName: 'level 2' }))
      .toBe('brampton-level-2-bv-brampton-2025-26');
  });
  it('ignores the level being edited via exceptLevelId', async () => {
    expect(await findNameConflict(db, { location: 'Brampton', pid: 'bv-brampton-2025-26', normalizedName: 'level 2', exceptLevelId: 'brampton-level-2-bv-brampton-2025-26' }))
      .toBeNull();
  });
  it('allows the same name at a DIFFERENT location', async () => {
    expect(await findNameConflict(db, { location: 'Scarborough', pid: 'bv-brampton-2025-26', normalizedName: 'level 2' }))
      .toBeNull();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @cmt/portal test -- level-name-conflict`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `findNameConflict`**

Create `apps/portal/src/features/setu/teacher/level-name-conflict.ts`:

```ts
import type { Firestore } from '@cmt/firebase-shared/admin/firestore';

/** Normalize a level name for collision comparison: trim, collapse spaces, lowercase. */
export function normalizeLevelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The levelId of an EXISTING level in the same (location, pid) whose name
 * normalizes-equal to `normalizedName`, or null. Single-field `pid` query (no
 * composite index); location + name compared in memory. `exceptLevelId` skips the
 * level being renamed so a no-op rename never conflicts with itself.
 */
export async function findNameConflict(
  db: Firestore,
  args: { location: string; pid: string; normalizedName: string; exceptLevelId?: string },
): Promise<string | null> {
  const snap = await db.collection('levels').where('pid', '==', args.pid).get();
  for (const doc of snap.docs) {
    if (doc.id === args.exceptLevelId) continue;
    const d = doc.data() as { location?: unknown; levelName?: unknown };
    if (d.location !== args.location) continue;
    if (typeof d.levelName !== 'string') continue;
    if (normalizeLevelName(d.levelName) === args.normalizedName) return doc.id;
  }
  return null;
}
```

(Confirm the `Firestore` type export path; if `@cmt/firebase-shared/admin/firestore` does not re-export the type, use `FirebaseFirestore.Firestore`.)

- [ ] **Step 5: Run the unit test (green)**

Run: `pnpm --filter @cmt/portal test -- level-name-conflict`
Expected: PASS.

- [ ] **Step 6: Wire the check into POST (create)**

In `apps/portal/src/app/api/admin/levels/route.ts`, after `parsed` succeeds and BEFORE `db.collection('levels').doc(levelId).create(...)`, add:

```ts
import { findNameConflict, normalizeLevelName } from '@/features/setu/teacher/level-name-conflict';
// … inside POST, after computing `data` + `db`:
const conflict = await findNameConflict(db, {
  location: data.location,
  pid: data.pid,
  normalizedName: normalizeLevelName(data.levelName),
});
if (conflict) {
  return NextResponse.json({ error: 'level-conflict', levelId: conflict }, { status: 409 });
}
```

Keep the existing `catch` on Firestore code 6 as a backstop. Since `ageLabel` is now optional, the create write must guard it: change `ageLabel: data.ageLabel,` → only set it when present, e.g. build the doc object and add `...(data.ageLabel ? { ageLabel: data.ageLabel } : {})`.

- [ ] **Step 7: Wire the check into PATCH (rename)**

In `apps/portal/src/app/api/admin/levels/[levelId]/route.ts`, after loading `existing` and validating, when `data.levelName` is present and differs, add:

```ts
import { findNameConflict, normalizeLevelName } from '@/features/setu/teacher/level-name-conflict';
// … after `const existing = snap.data() as LevelDoc;` and the writable-year check:
if (data.levelName !== undefined && normalizeLevelName(data.levelName) !== normalizeLevelName(existing.levelName)) {
  const conflict = await findNameConflict(db, {
    location: existing.location ?? '',
    pid: existing.pid,
    normalizedName: normalizeLevelName(data.levelName),
    exceptLevelId: levelId,
  });
  if (conflict) {
    return NextResponse.json({ error: 'level-conflict', levelId: conflict }, { status: 409 });
  }
}
```

- [ ] **Step 8: Add route-level collision tests**

In the admin levels route tests: POST a duplicate name (different case/spacing) at the same location+pid → expect 409 `level-conflict`; POST the same name at a different location → 201; PATCH-rename a level to an existing sibling's name → 409; PATCH-rename to a fresh unique name → 200.

- [ ] **Step 9: Run the level route suites + typecheck**

Run: `pnpm --filter @cmt/portal test -- api/admin/levels && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/portal/src/features/setu/teacher/level-name-conflict.ts apps/portal/src/features/setu/teacher/__tests__/level-name-conflict.test.ts apps/portal/src/app/api/admin/levels/route.ts apps/portal/src/app/api/admin/levels/[levelId]/route.ts apps/portal/src/app/api/admin/levels/__tests__ apps/portal/src/app/api/admin/levels/[levelId]/__tests__
git commit -m "fix(slice3): level-name collision — enforce normalized-name uniqueness within (location, period) on create + rename"
```

---

## Task 5: Guest-add grade dropdown

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx` (Grade `<input>` → `<select>`)
- Test: `apps/portal/src/features/setu/teacher/components/__tests__/*` (if a visitors-panel test exists; else add a focused render test)

**Interfaces:**
- Consumes: `CHILD_GRADE_OPTIONS` (Task 1). `AddVisitorSchema.schoolGrade` stays `nullable` — blank stays `null`.

- [ ] **Step 1: Replace the free-text Grade input with a select**

In `visitors-panel.tsx`:
- Add `import { CHILD_GRADE_OPTIONS } from '@cmt/shared-domain';`
- Replace the Grade `<input value={grade} …/>` block with:

```tsx
<div style={{ minWidth: 0 }}>
  <span style={label}>Grade</span>
  <select
    value={grade}
    onChange={(e) => setGrade(e.target.value)}
    aria-label="Grade"
    style={field}
  >
    <option value="">Grade (optional)</option>
    {CHILD_GRADE_OPTIONS.map((g) => (
      <option key={g.value} value={g.value}>{g.label}</option>
    ))}
  </select>
</div>
```

The existing `onQuickAdd` already sends `schoolGrade: grade.trim() || null`, so a blank selection → `null`. No schema change.

- [ ] **Step 2: Add/adjust a render test**

Add a focused test rendering `VisitorsPanel` and asserting the Grade control is a `combobox` (select) whose options include "Grade 1" and "SK". If no jsdom test harness exists for this client component, cover it via the E2E in Task 13 instead and note that here.

- [ ] **Step 3: Run + typecheck**

Run: `pnpm --filter @cmt/portal test -- visitors-panel && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/features/setu/teacher/components/visitors-panel.tsx apps/portal/src/features/setu/teacher/components/__tests__
git commit -m "feat(slice3): guest-add grade dropdown (CHILD_GRADE_OPTIONS)"
```

---

## Task 6: Narrow Setu attendance write schemas to Present/Absent

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/attendance.ts` (add `SETU_ATTENDANCE_WRITE_STATUSES`; use it in `SaveAttendanceSchema` + `MarkGuestSchema`; keep `AttendanceEventDocSchema.status` tolerant)
- Modify: `packages/shared-domain/src/setu/__tests__/attendance-schemas.test.ts`
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

**Interfaces:**
- Produces: `SETU_ATTENDANCE_WRITE_STATUSES = ['present','absent'] as const`; `SaveAttendanceInput.marks` and `MarkGuestInput.status` now reject `'late'`. `AttendanceEventDoc.status` still accepts `'late'` on read.

- [ ] **Step 1: Write the failing schema tests**

Add to `attendance-schemas.test.ts`:

```ts
import { SaveAttendanceSchema, MarkGuestSchema, AttendanceEventDocSchema, SETU_ATTENDANCE_WRITE_STATUSES } from '../schemas/attendance';

describe('attendance write statuses are binary', () => {
  it('SETU_ATTENDANCE_WRITE_STATUSES is present/absent only', () => {
    expect([...SETU_ATTENDANCE_WRITE_STATUSES]).toEqual(['present', 'absent']);
  });
  it('SaveAttendanceSchema rejects late marks', () => {
    const r = SaveAttendanceSchema.safeParse({ levelId: 'l', date: '2026-01-04', marks: { m1: 'late' } });
    expect(r.success).toBe(false);
  });
  it('SaveAttendanceSchema accepts present/absent', () => {
    expect(SaveAttendanceSchema.safeParse({ levelId: 'l', date: '2026-01-04', marks: { m1: 'present', m2: 'absent' } }).success).toBe(true);
  });
  it('MarkGuestSchema rejects late', () => {
    expect(MarkGuestSchema.safeParse({ levelId: 'l', date: '2026-01-04', mid: 'm', status: 'late' }).success).toBe(false);
  });
  it('AttendanceEventDocSchema still READS a historical late event', () => {
    const doc = { aid: 'a', levelId: 'l', mid: 'm', fid: 'f', pid: 'p', date: '2025-11-02', status: 'late', isGuest: false, markedByUid: 'u', markedByMid: null, markedAt: new Date(), updatedAt: new Date() };
    expect(AttendanceEventDocSchema.safeParse(doc).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @cmt/shared-domain test -- attendance-schemas`
Expected: FAIL — `SETU_ATTENDANCE_WRITE_STATUSES` undefined; late marks currently accepted.

- [ ] **Step 3: Implement the write-status set**

In `packages/shared-domain/src/setu/schemas/attendance.ts`:
- Add after the existing `SETU_ATTENDANCE_STATUSES`:
  ```ts
  // Statuses a teacher can WRITE going forward — binary Present/Absent (Late is
  // retired). AttendanceEventDoc.status stays the wider SETU_ATTENDANCE_STATUSES
  // so historical 'late' events remain valid on read.
  export const SETU_ATTENDANCE_WRITE_STATUSES = ['present', 'absent'] as const;
  export type SetuAttendanceWriteStatus = (typeof SETU_ATTENDANCE_WRITE_STATUSES)[number];
  ```
- In `SaveAttendanceSchema`, change `marks: z.record(z.string().min(1), z.enum(SETU_ATTENDANCE_STATUSES))` → `z.enum(SETU_ATTENDANCE_WRITE_STATUSES)`.
- In `MarkGuestSchema`, change `status: z.enum(SETU_ATTENDANCE_STATUSES).default('present')` → `z.enum(SETU_ATTENDANCE_WRITE_STATUSES).default('present')`.
- Leave `AttendanceEventDocSchema.status: z.enum(SETU_ATTENDANCE_STATUSES)` unchanged.

- [ ] **Step 4: Run it (green) + the wider suite**

Run: `pnpm --filter @cmt/shared-domain test -- attendance`
Expected: PASS.

- [ ] **Step 5: Confirm the portal write paths still typecheck**

`save-attendance.ts` and `guests.ts` type their status params as `SetuAttendanceStatus` (a superset) — assigning a write-status value is assignable, so no change needed. Run: `pnpm --filter @cmt/portal typecheck`. If a caller now needs the narrower type, adjust to `SetuAttendanceWriteStatus`.

- [ ] **Step 6: Append the mobile changelog entry**

Add a dated entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md` keyed `<SHA>` (backfill the SHA after commit):

```markdown
## 2026-07-03 — `<SHA>` — Attendance is Present/Absent only (Late retired)
`POST /api/setu/teacher/attendance` (`marks`) and `POST /api/setu/teacher/guests` (`status`) now accept only `present` | `absent`. Sending `late` → 400 `bad-request`. Reads are unchanged (historical `late` events still returned). **Mobile:** drop `late` from the attendance marker UI and never send it; render any historical `late` in read views as needed.
```

- [ ] **Step 7: Commit + backfill SHA**

```bash
git add packages/shared-domain/src/setu/schemas/attendance.ts packages/shared-domain/src/setu/__tests__/attendance-schemas.test.ts apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(slice3): narrow Setu attendance writes to present/absent (read stays tolerant); mobile changelog"
```
Then edit the changelog `<SHA>` → the new commit's short SHA and amend:
```bash
git commit --amend --no-edit apps/portal/docs/MOBILE_API_CHANGELOG.md
```

---

## Task 7: Reports — fold Late into Present, drop the Late column

**Files:**
- Modify: `packages/shared-domain/src/setu/reports.ts` (`AttendanceRowSchema` — remove `late`)
- Modify: `apps/portal/src/features/setu/reports/attendance-report.ts` (Tally + fold)
- Modify: `apps/portal/src/features/setu/reports/report-csv.ts` (drop late column)
- Modify: `apps/portal/src/features/setu/reports/reports-hub.tsx` (drop late column)
- Test: `apps/portal/src/features/setu/reports/__tests__/attendance-report.test.ts`

**Interfaces:**
- `AttendanceReport` rows lose `late`; `present` absorbs former `late` events; `rate = present / total`.

- [ ] **Step 1: Update the failing report test (N=2 incl. a historical late)**

In `attendance-report.test.ts`, seed `attendanceEvents` for a level with **2 present, 1 absent, and 1 `late`** on dates in range. Assert the level row = `{ present: 3, absent: 1, total: 4, rate: 0.75 }` and that the row has **no `late` key**. (The late event folds into present.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @cmt/portal test -- attendance-report`
Expected: FAIL — current code reports `present:2, late:1`.

- [ ] **Step 3: Fold late→present in `attendance-report.ts`**

- `type Tally = { present: number; absent: number };` and `const zero = (): Tally => ({ present: 0, absent: 0 });`
- `function rate(t: Tally) { const total = t.present + t.absent; return { total, rate: total === 0 ? 0 : t.present / total }; }`
- In the loop, change the status mapping so `late` counts as present:
  ```ts
  const raw = e.status;
  const status = raw === 'present' || raw === 'late' ? 'present' : raw === 'absent' ? 'absent' : null;
  if (!levelId || !status) continue;
  ```
  (Everything else — `byLevel.get(levelId)![status]++` etc. — is unchanged; `status` is now only 'present'|'absent'.)

- [ ] **Step 4: Remove `late` from the report schema**

In `packages/shared-domain/src/setu/reports.ts`, in `AttendanceRowSchema`, delete the `late: z.number().int().nonnegative(),` line and update the `rate` comment to `// present / total`.

- [ ] **Step 5: Drop the late column from CSV + hub**

- `report-csv.ts` `attendanceReportToCsv`: header `['scope','key','label','present','absent','total','rate']`; drop `l.late` / `p.late` from both row maps.
- `reports-hub.tsx`: remove the `{ key: 'late', label: 'Late', numeric: true }` column; remove `late: l.late` / `late: p.late` from the two `rows={…}` maps; change the subtitle "Present / absent / late rollup…" → "Present / absent rollup over a date range."

- [ ] **Step 6: Run report tests + typecheck**

Run: `pnpm --filter @cmt/portal test -- reports && pnpm --filter @cmt/shared-domain test -- reports && pnpm --filter @cmt/portal typecheck`
Expected: PASS. (`enrollment-report.ts` still references `late` in its own present-or-late engagement check — leave it; new data has no late, so behavior is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared-domain/src/setu/reports.ts apps/portal/src/features/setu/reports/attendance-report.ts apps/portal/src/features/setu/reports/report-csv.ts apps/portal/src/features/setu/reports/reports-hub.tsx apps/portal/src/features/setu/reports/__tests__/attendance-report.test.ts
git commit -m "feat(slice3): reports fold Late into Present and drop the Late column"
```

---

## Task 8: Legacy `/check-in/teacher` marker → Present/Absent radios only

**Files:**
- Modify: `apps/portal/src/features/check-in/teacher/attendance-marker.tsx` (render only present/absent radios)
- Test: `apps/portal/src/features/check-in/teacher/__tests__/*attendance-marker*` (assert 2 status columns)

**Interfaces:**
- UI-only. The legacy `ATTENDANCE_STATUSES` enum, the `attendance/{date}/{classId}` write path, the `/check-in/teacher/uninformed` page, and `attendance-status-badge` are **unchanged** (historical late/uninformed still read + display).

- [ ] **Step 1: Update the failing marker test**

In the legacy attendance-marker test, assert the header renders exactly two status columns ("Present", "Absent") and that there is no "Late"/"Uninformed" radio. If the test currently maps `ATTENDANCE_STATUSES`, switch it to a local binary list assertion.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @cmt/portal test -- check-in/teacher`
Expected: FAIL — 4 columns currently render.

- [ ] **Step 3: Restrict the marker to present/absent**

In `apps/portal/src/features/check-in/teacher/attendance-marker.tsx`:
- Add a module-local `const WRITE_STATUSES = ['present', 'absent'] as const;`
- Replace both `ATTENDANCE_STATUSES.map(...)` usages (the `<thead>` columns and the per-student radio cells) with `WRITE_STATUSES.map(...)`.
- Keep the `AttendanceStatus` type import for the state type; the default seed `'present'` is unchanged. The POST body still targets `/api/check-in/teacher/attendance`, whose schema accepts the wider enum — sending only present/absent is valid.

- [ ] **Step 4: Run it (green) + typecheck**

Run: `pnpm --filter @cmt/portal test -- check-in/teacher && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/check-in/teacher/attendance-marker.tsx apps/portal/src/features/check-in/teacher/__tests__
git commit -m "feat(slice3): legacy check-in teacher marker offers Present/Absent only (data + uninformed page unchanged)"
```

---

## Task 9: Teacher name-search endpoint

**Files:**
- Create: `apps/portal/src/features/setu/teacher/search-teachers.ts`
- Create: `apps/portal/src/features/setu/teacher/__tests__/search-teachers.test.ts`
- Create: `apps/portal/src/app/api/admin/teachers/search/route.ts`
- Create: `apps/portal/src/app/api/admin/teachers/search/__tests__/route.test.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts` (rule before the `/api/admin/` catch-all)
- Test: `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts`

**Interfaces:**
- Produces: `searchTeachers(q: string): Promise<TeacherSearchHit[]>` where `TeacherSearchHit = { mid: string; name: string; email: string | null; fid: string; location: string }`. Reuses `searchFamilies(q)` → adult members of the matched families. `GET /api/admin/teachers/search?q=` (admin OR welcome-team) → `{ hits }`.

- [ ] **Step 1: Write the failing test for `searchTeachers`**

Create `search-teachers.test.ts`: seed a family "Sharma" (searchKeys `['sharma']`) with two adults (one with email, one without) and one child. Assert `searchTeachers('Sharma')` returns the **two adults** (child excluded), each with `{mid, name, email, fid, location}`, deduped, and that a query with no hits returns `[]`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @cmt/portal test -- search-teachers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `searchTeachers`**

Create `apps/portal/src/features/setu/teacher/search-teachers.ts`:

```ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { searchFamilies } from '@/features/setu/search/search-families';

export interface TeacherSearchHit {
  mid: string;
  name: string;
  email: string | null;
  fid: string;
  location: string;
}

/**
 * Search assignable teachers by name/email/phone. Reuses the family search
 * (searchKeys array-contains — existing index), then surfaces each matched
 * family's ADULT members (a teacher is an adult) as {mid,name,email}. Bounded:
 * searchFamilies caps at 20 families; we read their members subcollections and
 * cap the result at 15 hits. Read-only. No new index.
 */
export async function searchTeachers(q: string): Promise<TeacherSearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const db = portalFirestore();
  const families = await searchFamilies(trimmed);
  if (families.length === 0) return [];

  const hits: TeacherSearchHit[] = [];
  const seen = new Set<string>();
  for (const fam of families) {
    const memSnap = await db.collection('families').doc(fam.fid).collection('members').get();
    for (const doc of memSnap.docs) {
      const m = doc.data() as { mid?: string; type?: string; firstName?: string; lastName?: string; email?: string | null };
      if (m.type !== 'Adult' || typeof m.mid !== 'string' || seen.has(m.mid)) continue;
      seen.add(m.mid);
      hits.push({
        mid: m.mid,
        name: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.mid,
        email: typeof m.email === 'string' && m.email ? m.email : null,
        fid: fam.fid,
        location: fam.location,
      });
      if (hits.length >= 15) return hits;
    }
  }
  return hits;
}
```

- [ ] **Step 4: Run it (green)**

Run: `pnpm --filter @cmt/portal test -- search-teachers`
Expected: PASS.

- [ ] **Step 5: Add the canAccessRoute rule (failing test first)**

In `can-access-route.test.ts`, assert `/api/admin/teachers/search` is allowed for admin and welcome-team, denied for a plain family. Run to confirm it fails, then in `can-access-route.ts`, BEFORE the `if (pathname.startsWith('/api/admin/')) return isAdmin(claims);` line, add:

```ts
// Teacher name-search — front-desk (welcome-team) may assign teachers too.
if (pathname === '/api/admin/teachers/search' || pathname.startsWith('/api/admin/teachers/')) {
  return isAdmin(claims) || isWelcomeTeam(claims);
}
```

- [ ] **Step 6: Implement the route + its test**

Create `apps/portal/src/app/api/admin/teachers/search/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { searchTeachers } from '@/features/setu/teacher/search-teachers';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session) && !isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return NextResponse.json({ hits: await searchTeachers(q) });
}
```

Route test: admin GET with `?q=Sharma` → 200 `{hits:[…]}`; welcome-team → 200; plain family → 403; empty `q` → `{hits:[]}`.

- [ ] **Step 7: Run the route + auth suites + typecheck**

Run: `pnpm --filter @cmt/portal test -- teachers/search && pnpm --filter @cmt/shared-domain test -- can-access-route && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/features/setu/teacher/search-teachers.ts apps/portal/src/features/setu/teacher/__tests__/search-teachers.test.ts apps/portal/src/app/api/admin/teachers apps/portal/src/app/api/admin/teachers/search/__tests__ packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/auth/__tests__/can-access-route.test.ts
git commit -m "feat(slice3): teacher name-search endpoint (admin + welcome-team) reusing family search"
```

---

## Task 10: Per-level teacher add / remove endpoints

**Files:**
- Create: `apps/portal/src/app/api/admin/levels/[levelId]/teachers/route.ts`
- Create: `apps/portal/src/app/api/admin/levels/[levelId]/teachers/__tests__/route.test.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts` (rule before the `/api/admin/` catch-all)
- Test: `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts`

**Interfaces:**
- Consumes: `assignTeacher`, `getTeacherLevelIds` (`@/features/setu/teacher/assignments`), `findMissingLevelIds` (`@/features/setu/teacher/levels`).
- `POST { mid }` unions `levelId` into the teacher's set; `DELETE { mid }` subtracts it. Both route through `assignTeacher` so `teacherAssignments.levelIds` and `levels.teacherRefs` stay in sync. Admin OR welcome-team; writable-year gated.

- [ ] **Step 1: Write the failing route test**

Create the route test: seed a level in a live-year pid + a teacher mid. `POST {mid}` → the level's `teacherRefs` includes mid AND `teacherAssignments/{mid}.levelIds` includes levelId. A second `POST {mid2}` → both mids on the level (N=2). `DELETE {mid}` → mid removed from both. Non-admin/non-welcome → 403. Unknown level → 404/400. Past-year level → 409 `past-year`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @cmt/portal test -- levels/[levelId]/teachers`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

Create `apps/portal/src/app/api/admin/levels/[levelId]/teachers/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin, isWelcomeTeam } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { assignTeacher, getTeacherLevelIds } from '@/features/setu/teacher/assignments';
import { findMissingLevelIds } from '@/features/setu/teacher/levels';
import { assertWritableYear, PastYearWriteError } from '@/features/setu/rollover/assert-writable-year';
import { schoolYearOfPid } from '@/features/setu/rollover/school-year';

const BodySchema = z.object({ mid: z.string().trim().min(1) });

async function guard(req: Request, levelId: string) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return { err: NextResponse.json({ error: 'no-session' }, { status: 401 }) };
  if (!isAdmin(session) && !isWelcomeTeam(session)) return { err: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  const missing = await findMissingLevelIds([levelId]);
  if (missing.length > 0) return { err: NextResponse.json({ error: 'unknown-levels', missing }, { status: 400 }) };
  const db = portalFirestore();
  const snap = await db.collection('levels').doc(levelId).get();
  const pid = snap.data()?.pid as string | undefined;
  try {
    if (pid) await assertWritableYear(db, schoolYearOfPid(pid));
  } catch (e) {
    if (e instanceof PastYearWriteError) return { err: NextResponse.json({ error: 'past-year', year: e.year, liveYear: e.liveYear }, { status: 409 }) };
    throw e;
  }
  return { session };
}

export async function POST(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  const g = await guard(req, levelId);
  if (g.err) return g.err;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const { mid } = parsed.data;
  const next = [...new Set([...(await getTeacherLevelIds(mid)), levelId])];
  const { added, removed } = await assignTeacher({ ref: mid, levelIds: next, byUid: g.session!.uid });
  return NextResponse.json({ ref: mid, levelId, added, removed });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  const g = await guard(req, levelId);
  if (g.err) return g.err;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const { mid } = parsed.data;
  const next = (await getTeacherLevelIds(mid)).filter((l) => l !== levelId);
  const { added, removed } = await assignTeacher({ ref: mid, levelIds: next, byUid: g.session!.uid });
  return NextResponse.json({ ref: mid, levelId, added, removed });
}
```

- [ ] **Step 4: Add the canAccessRoute rule (failing test first)**

In `can-access-route.test.ts`, assert `/api/admin/levels/brampton-level-2-bv-brampton-2025-26/teachers` is allowed for admin + welcome-team, denied for a plain family, while `/api/admin/levels/<id>` (CRUD) stays admin-only. Run red, then in `can-access-route.ts` BEFORE the `/api/admin/` catch-all add:

```ts
// Per-level teacher add/remove — admin + welcome-team (front-desk). Only the
// `/teachers` sub-path opens up; level CRUD stays admin-only via the catch-all.
if (/^\/api\/admin\/levels\/[^/]+\/teachers\/?$/.test(pathname)) {
  return isAdmin(claims) || isWelcomeTeam(claims);
}
```

- [ ] **Step 5: Run the route + auth suites + typecheck**

Run: `pnpm --filter @cmt/portal test -- levels/[levelId]/teachers && pnpm --filter @cmt/shared-domain test -- can-access-route && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/api/admin/levels/[levelId]/teachers packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/auth/__tests__/can-access-route.test.ts
git commit -m "feat(slice3): per-level teacher add/remove endpoints (sync teacherAssignments + teacherRefs via assignTeacher)"
```

---

## Task 11: Inline per-level teacher assignment UI — pills + search popover; delete the tab

**Files:**
- Modify: `apps/portal/src/app/admin/levels/page.tsx` (resolve teacher names, pass to table)
- Modify: `apps/portal/src/features/admin/levels/levels-table.tsx` (per-level pills + Assign popover)
- Rewrite: `apps/portal/src/features/admin/levels/levels-management.tsx` (drop the tab strip; render the table directly)
- Delete: `apps/portal/src/features/admin/levels/assign-teacher-form.tsx` (+ its tests)
- Create: `apps/portal/src/features/admin/levels/assign-teacher-client.ts` (fetch wrappers)
- Test: `apps/portal/src/features/admin/levels/__tests__/*`

**Interfaces:**
- Consumes: `getBvTeacherNames` (`@/features/setu/attendance/get-bv-teacher-names`), `searchTeachers` route (Task 9), per-level teacher routes (Task 10).
- The server page passes `teachersByLevel: Record<string, {mid:string;name:string}[]>` into `LevelsManagement` → `LevelsTable`.

- [ ] **Step 1: Resolve teacher names in the server page**

In `apps/portal/src/app/admin/levels/page.tsx`, after building `levels`, resolve names in bulk and build a `mid → name` + per-level list:

```ts
import { getBvTeacherNames } from '@/features/setu/attendance/get-bv-teacher-names';
// … after `levels` is built (filtered to view.year):
const nameMap = await getBvTeacherNames(levels.map((l) => l.levelId)); // levelId → string[] (names, teacherRefs order)
const teachersByLevel: Record<string, { mid: string; name: string }[]> = {};
for (const l of levels) {
  const names = nameMap.get(l.levelId) ?? [];
  teachersByLevel[l.levelId] = l.teacherRefs.map((mid, i) => ({ mid, name: names[i] ?? mid }));
}
```

Pass `teachersByLevel={teachersByLevel}` to `<LevelsManagement …>`.

Note: `getBvTeacherNames` skips unresolved mids, so `names[i]` may misalign when a ref doesn't resolve. To keep mid↔name aligned, instead resolve name-by-mid: change this step to call a small inline bulk read OR extend `getBvTeacherNames` return to a `Map<levelId, {mid,name}[]>`. **Preferred:** add an exported `getTeacherNamesByMid(mids: string[]): Promise<Map<string,string>>` to `get-bv-teacher-names.ts` (factor out its step-2 bulk lookup) and build `teachersByLevel` from `l.teacherRefs.map(mid => ({ mid, name: byMid.get(mid) ?? mid }))`. Do that refactor here (keep `getBvTeacherNames` working by having it call the new helper).

- [ ] **Step 2: Thread the prop through `LevelsManagement` and drop the tab**

Rewrite `levels-management.tsx` to remove the `Tab` state, the tab strip, and the `AssignTeacherForm` branch. It renders the `LevelsTable` directly inside the card, forwarding `teachersByLevel`, `onLevelsChange`, `readOnly`. Keep the `handleAssignmentSaved` local-state updater but adapt it to the per-level add/remove shape (see Step 4).

- [ ] **Step 3: Add fetch wrappers**

Create `apps/portal/src/features/admin/levels/assign-teacher-client.ts`:

```ts
'use client';
export interface TeacherHit { mid: string; name: string; email: string | null; fid: string; location: string }

export async function searchTeachersClient(q: string): Promise<TeacherHit[]> {
  const res = await fetch(`/api/admin/teachers/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`teacher-search-${res.status}`);
  return ((await res.json()).hits as TeacherHit[]) ?? [];
}

export async function addLevelTeacherClient(levelId: string, mid: string): Promise<void> {
  const res = await fetch(`/api/admin/levels/${encodeURIComponent(levelId)}/teachers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid }),
  });
  if (!res.ok) throw new Error(`add-teacher-${res.status}`);
}

export async function removeLevelTeacherClient(levelId: string, mid: string): Promise<void> {
  const res = await fetch(`/api/admin/levels/${encodeURIComponent(levelId)}/teachers`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid }),
  });
  if (!res.ok) throw new Error(`remove-teacher-${res.status}`);
}
```

- [ ] **Step 4: Add per-level pills + Assign popover to `LevelsTable`**

In `levels-table.tsx`:
- Add prop `teachersByLevel: Record<string, { mid: string; name: string }[]>` to `LevelsTableProps` (and `LevelsManagementProps`).
- Add local state `const [assigning, setAssigning] = useState<string | null>(null);` (which levelId's popover is open) and a per-level teacher list mirrored in state so pills update optimistically: `const [teachers, setTeachers] = useState(teachersByLevel);`
- Replace the "Teachers" cell in BOTH the desktop table and mobile card (currently `{l.teacherRefs.length}`) with a pills+button block:

```tsx
<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
  {(teachers[l.levelId] ?? []).map((t) => (
    <span key={t.mid} className="pill" style={{ fontSize: 11, fontWeight: 600, background: 'var(--surface2)', color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {t.name}
      {!readOnly && (
        <button type="button" aria-label={`Remove ${t.name}`} onClick={() => void handleRemoveTeacher(l.levelId, t.mid)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
      )}
    </span>
  ))}
  {!readOnly && (
    <button type="button" onClick={() => setAssigning(l.levelId)} style={{ ...actionBtnStyle, padding: '3px 10px' }}>+ Assign teacher</button>
  )}
</div>
```

- Add `handleAddTeacher(levelId, hit)` and `handleRemoveTeacher(levelId, mid)` that call the client wrappers, update `teachers` state + the parent via `onAssignmentSaved`, and `toast.success/error`. Render an `AssignTeacherPopover` (a small inline component in this file) when `assigning === l.levelId`: a search input (debounced or on-submit) calling `searchTeachersClient`, showing results as `name — email` rows; clicking a row calls `handleAddTeacher` then closes. Guard against adding a mid already present.

- [ ] **Step 5: Delete the old tab form**

Delete `assign-teacher-form.tsx` and its test file. Remove its import from `levels-management.tsx`. `grep -rn "assign-teacher-form\|AssignTeacherForm"` → expect no remaining references.

- [ ] **Step 6: Update/adjust component tests**

Update `levels-management`/`levels-table` tests: assert no "Teacher assignments" tab; assert a level row renders its teacher name pills (N=2 teachers) and an "Assign teacher" button; assert the popover search calls the client wrapper (mock `assign-teacher-client`). Follow the memory rule: mock the `-client` wrapper, never the server fn.

- [ ] **Step 7: Run the admin levels tests + typecheck**

Run: `pnpm --filter @cmt/portal test -- admin/levels && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/app/admin/levels/page.tsx apps/portal/src/features/admin/levels apps/portal/src/features/setu/attendance/get-bv-teacher-names.ts
git rm apps/portal/src/features/admin/levels/assign-teacher-form.tsx
git commit -m "feat(slice3): inline per-level teacher pills + name-search assign; remove the teacher-assignments tab"
```

---

## Task 12: Fix teacher-list-empty-after-rollover (reproduce first)

**Files:**
- Modify: `apps/portal/src/features/setu/rollover/prefill-teachers.ts` (sync `teacherAssignments` alongside `teacherRefs`)
- Test: `apps/portal/src/features/setu/rollover/__tests__/prefill-teachers.test.ts`

**Interfaces:**
- Consumes: `assignTeacher` (`@/features/setu/teacher/assignments`). After prefill, for every carried-forward ref, BOTH `levels/{target}.teacherRefs` AND `teacherAssignments/{ref}.levelIds` contain the target levelId.

- [ ] **Step 1: REPRODUCE in UAT (read-only) — confirm the symptom**

Per the firm directive + `reproducing-setu-bugs-in-uat`: on deployed UAT, inspect a rolled-over year. Script (throwaway) that, for a source teacher ref, prints (a) `levels` where `teacherRefs array-contains <ref>` (their "my classes" source), and (b) `teacherAssignments/{ref}.levelIds`. Confirm the asymmetry — after `copy-teachers`, target levels carry the ref but `teacherAssignments.levelIds` still lists only source-year levelIds (or the classes list is empty because copy-teachers was never run). Capture the ACTUAL state:

```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local /tmp/repro-rollover-teachers.ts <teacher-mid>
```
Record findings in the task report. If the real cause differs from the asymmetry hypothesis, adjust the fix. Delete the throwaway script.

- [ ] **Step 2: Write the failing test**

In `prefill-teachers.test.ts`, seed a source level with `teacherRefs:['mid-a','mid-b']` (N=2) and its twin target level with `teacherRefs:[]`, plus source `teacherAssignments/mid-a` and `/mid-b` listing the source levelId. Run `prefillTeachers({dryRun:false, …})`. Assert: (a) target `levels/{target}.teacherRefs` contains both mids (existing behavior); (b) **NEW:** `teacherAssignments/mid-a.levelIds` and `/mid-b.levelIds` now ALSO contain the target levelId; (c) idempotent re-run doesn't duplicate; (d) a target with a pre-existing non-empty `teacherRefs` is skipped (never clobbered).

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @cmt/portal test -- prefill-teachers`
Expected: FAIL — `teacherAssignments` not updated by current prefill.

- [ ] **Step 4: Sync `teacherAssignments` in `prefillTeachers`**

In `prefill-teachers.ts`, replace the direct `targetRef.set({ teacherRefs: refs, … })` write with a call that also updates each ref's assignment doc. Import `assignTeacher` and, for each filled target level, for each ref in `refs`, union the target levelId into that ref's set:

```ts
import { assignTeacher, getTeacherLevelIds } from '@/features/setu/teacher/assignments';
// … inside the loop, replacing the `if (!args.dryRun) { await targetRef.set(...) }` block:
filled.push(targetId);
if (!args.dryRun) {
  // Sync BOTH sources of truth: assignTeacher sets teacherAssignments.levelIds
  // (drives the `teacher` capability + admin pills) AND arrayUnion's the level's
  // teacherRefs (drives getMyLevels). Per ref so we never drop other assignments.
  for (const ref of refs) {
    const next = [...new Set([...(await getTeacherLevelIds(ref)), targetId])];
    await assignTeacher({ ref, levelIds: next, byUid: args.actorMid });
  }
}
```

This removes the need for the standalone `targetRef.set({ teacherRefs })` — `assignTeacher` arrayUnions each ref onto `levels/{targetId}.teacherRefs`. Confirm the `updatedAt/updatedBy` on the target level is still acceptable (assignTeacher writes `teacherRefs` via merge; the level's `updatedAt` isn't touched by assignTeacher — if the test asserts it, set it separately, otherwise leave it).

- [ ] **Step 5: Run it (green) + the rollover suite**

Run: `pnpm --filter @cmt/portal test -- prefill-teachers rollover && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/rollover/prefill-teachers.ts apps/portal/src/features/setu/rollover/__tests__/prefill-teachers.test.ts
git commit -m "fix(slice3): rollover teacher carry-forward syncs teacherAssignments + teacherRefs (fixes empty teacher list)"
```

---

## Task 13: Deployed-UAT E2E specs + runbook (write now, run at the owner gate)

**Files:**
- Create/Modify: `apps/portal/e2e/setu/admin/level-management.spec.ts`
- Create/Modify: `apps/portal/e2e/setu/teacher/attendance-binary.spec.ts`
- Modify: `apps/portal/scripts/seed-e2e-family.ts` (ensure the fixture has a teacher member + a level to assign, and a historical `late` event for the reports fold — only if needed by the specs)
- Modify: `docs/runbooks/production-cutover-checklist.md` (§14 dated entry)

**Interfaces:**
- Consumes the seeded UAT fixture (`e2e-family@chinmayatoronto.org`, admin role). Specs run against `https://cmt-setu.vercel.app` at the owner gate — NOT in the pre-push hook.

- [ ] **Step 1: Write the level-management E2E**

`level-management.spec.ts` (Playwright, `--project=setu`, password sign-in via `e2e/auth-helpers.ts`): as admin, open `/admin/levels`; create a level via the grade **dropdown** (tick "Grade 2" + "Grade 3"), Curriculum set, no age field present; assert it appears with the derived grade label; assert a rename to an existing sibling name shows the conflict error. Then assign a teacher inline: click "Assign teacher" on a level, search a seeded teacher by name, pick them, assert the **name pill** appears; remove the pill. Mutations clean up after themselves (delete the created level / clear the assignment) in `afterAll`.

- [ ] **Step 2: Write the binary-attendance E2E**

`attendance-binary.spec.ts`: as the seeded teacher, open `/teacher/levels/<levelId>/attendance`; assert the roster shows tap-to-present rows (no Late/Uninformed control); mark two present, save, reload → persisted. If the legacy `/check-in/teacher` is reachable in UAT with the seeded data, add a check that its marker shows only Present/Absent columns.

- [ ] **Step 3: Extend the seed if the specs need it**

Only if the specs require data the fixture lacks: in `seed-e2e-family.ts`, ensure a teacher-capable adult member exists and is assignable, and (for a reports check, if included) write one historical `late` `attendanceEvents` doc. Keep it idempotent and `_test:true`-tagged. Update the runbook §10 if a new flag/seed option is added.

- [ ] **Step 4: Local dry-run of the spec files (compile only)**

Run: `pnpm --filter @cmt/portal exec playwright test --project=setu level-management attendance-binary --list`
Expected: the specs are discovered and list their tests (no execution against UAT yet — that happens at the owner gate).

- [ ] **Step 5: Runbook §14 entry**

Add a dated `2026-07-03` entry to `docs/runbooks/production-cutover-checklist.md` §14 summarizing Slice 3: grade dropdowns from the canonical source; per-level teacher assignment (new `/api/admin/teachers/search` + `/api/admin/levels/[id]/teachers`); attendance writes present/absent (mobile changelog); reports drop the Late column; rollover teacher carry-forward now syncs both sources. Note: no new Firestore indexes; no new flag.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/e2e/setu apps/portal/scripts/seed-e2e-family.ts docs/runbooks/production-cutover-checklist.md
git commit -m "test(slice3): deployed-UAT E2E specs for level management + binary attendance; runbook §14"
```

---

## Final steps (controller, after all tasks reviewed)

- [ ] Run the FULL gate locally (never mask exit codes with `| tail`): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all green, build succeeds.
- [ ] Single batch push to `main` (pre-push hook re-runs the gate).
- [ ] **Owner UAT gate:** after the owner redeploys, run the Task 13 specs against `https://cmt-setu.vercel.app` (separately, clearing the OTP limiter between specs). Reproduce the two bug fixes' symptoms as GONE on deployed UAT.
- [ ] Backfill the `MOBILE_API_CHANGELOG.md` SHA if it drifted after rebmase/amends.
- [ ] Update the memory note + `.superpowers/sdd/progress.md` to "Slice 3 COMPLETE".

---

## Self-Review

**1. Spec coverage:**
- Workstream A (grade dropdown, remove age, collision) → Tasks 1, 2, 3, 4. ✓
- Workstream B (per-level assign, name search, pills, delete tab) → Tasks 9, 10, 11. ✓
- Workstream C (Present/Absent) → Tasks 6 (writes), 7 (reports), 8 (legacy UI). ✓
- Workstream D (guest-add dropdown) → Task 5. ✓
- Workstream E (rollover fix) → Task 12. ✓
- Cross-cutting: MOBILE_API_CHANGELOG (Task 6), canAccessRoute (Tasks 9, 10), E2E + runbook (Task 13). ✓
- Both bug fixes reproduce-in-UAT-first (Tasks 4, 12). ✓
- No new Firestore index (collision uses single-`pid` read; teacher search reuses family index; per-level writes are single-doc). ✓

**2. Placeholder scan:** No "TBD/TODO". Bug-fix Tasks 4 & 12 intentionally begin with a reproduction step (a project requirement), then contain complete fix code. UI edits give exact old→new blocks against the current code.

**3. Type consistency:** `levelGradeSummary(Pick<LevelDoc,'levelKind'|'gradeBand'>)`, `GRADE_BAND_OPTIONS`/`CHILD_GRADE_OPTIONS`, `SETU_ATTENDANCE_WRITE_STATUSES`, `findNameConflict`/`normalizeLevelName`, `searchTeachers`/`TeacherSearchHit`, per-level route body `{mid}`, `teachersByLevel: Record<string,{mid,name}[]>`, and `assignTeacher({ref,levelIds,byUid})` are used consistently across tasks. `ageLabel` optional in Task 1 is respected by Tasks 2–4 (omit key, never assign `undefined`).
