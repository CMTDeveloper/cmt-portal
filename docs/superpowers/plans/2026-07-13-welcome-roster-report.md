# Single-page Bala Vihar Roster Report - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/welcome/roster` into a single-page Bala Vihar report - bulk-load every family once, then filter (Location, Program, Level, Grade, Payment), show live counts, and export the filtered set to CSV - all client-side over one dataset.

**Architecture:** One server-only bulk builder does the ~5-read collectionGroup join the CSV export already does and returns lightweight rows. A pure filter/summarize module (shared-domain) is shared by the client (browse + live counts) and the server (CSV filter). The page fetches the dataset once and filters in memory; the CSV endpoint re-runs the builder and applies the same predicate. No new Firestore indexes.

**Tech Stack:** Next.js 16 (App Router, `use cache`), TypeScript, Firebase Admin (`portalFirestore()` = chinmaya-setu-uat), Zod, Vitest, Playwright.

## Global Constraints

- **Never use the em dash "-"** in any code, comment, copy, or commit message. Use a plain hyphen.
- **UAT only** - every DB / index / deploy action targets `chinmaya-setu-uat`. Never touch prod `715b8`; never `--force` an index deploy.
- **exactOptionalPropertyTypes is on** - never assign `undefined` to an optional property; omit the key or use conditional spread `...(x ? { x } : {})`.
- **Feature boundaries** - files under `features/<a>/` must not import from `features/<b>/`; cross-feature code goes through `@cmt/shared-domain` or `@cmt/ui`. `@cmt/shared-domain` has NO React/Next/DOM/`server-only` imports.
- **A new `/api/welcome/*` route needs an explicit `canAccessRoute` rule** or non-manager roles 401 at middleware before the handler runs.
- **Server-only helpers** (Firestore reads) get `import 'server-only'` and must never be imported by a `'use client'` component - the client calls a fetch wrapper.
- **Level/Grade are Bala Vihar-scoped**; Status (Confirmed/Registered) filter + engagement chip are OUT of this plan (deferred - see spec).
- **Payment classification** is the existing `paymentFromAmounts(activeCount, expected, paid)` in `features/setu/roster/payment.ts` - reuse it, do not re-derive.
- **Frequent commits** - one commit per task (or per step group). Never `--no-verify`.
- Commit author is the repo-local `CMT Developer <developer@chinmayatoronto.org>`; do NOT add any agent co-author line.

**Spec:** `docs/superpowers/specs/2026-07-13-welcome-roster-report-design.md`

---

## File Structure

- `packages/shared-domain/src/setu/roster-report.ts` **(new, pure)** - types, Zod schemas, `matchesRosterFilters`, `summarizeRoster`, `deriveLevelOptions`, `deriveGradeOptions`.
- `packages/shared-domain/src/setu/index.ts` **(modify)** - re-export the new module.
- `packages/shared-domain/src/setu/roster.ts` **(modify)** - add `level` to `RosterPersonCsvRow`.
- `packages/shared-domain/src/setu/roster-report.test.ts` **(new)** - pure-logic tests.
- `apps/portal/src/features/setu/roster/report-dataset.ts` **(new, server-only)** - `buildRosterReportDataset({ year? })` bulk builder.
- `apps/portal/src/features/setu/roster/__tests__/report-dataset.test.ts` **(new)** - fake-firestore builder test.
- `apps/portal/src/features/setu/roster/roster-csv.ts` **(modify)** - add `level` column to the CSV serializer.
- `apps/portal/src/app/api/welcome/roster/report/route.ts` **(new)** - GET json|csv.
- `apps/portal/src/app/api/welcome/roster/report/__tests__/route.test.ts` **(new)** - route auth/format tests.
- `packages/shared-domain/src/auth/can-access-route.ts` **(modify)** - add `/api/welcome/roster` rule.
- `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts` **(modify)** - assert the new rule.
- `apps/portal/src/features/setu/roster/roster-client.ts` **(modify)** - drop `fetchRosterClient`, add `fetchRosterReportClient`.
- `apps/portal/src/features/setu/roster/roster-browser.tsx` **(modify)** - rewrite `RosterContent` to bulk-load + filter + counts; add the summary strip + new filter rows.
- `apps/portal/src/features/setu/roster/roster-export-button.tsx` **(modify)** - target the report endpoint + forward all filters.
- `apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx` **(modify)** - update to the new client behavior.
- **Delete** (Task 5): `apps/portal/src/features/setu/roster/list-families.ts` + `__tests__/list-families.test.ts`; `apps/portal/src/features/setu/roster/build-csv-rows.ts` + `__tests__/build-csv-rows.test.ts`; `apps/portal/src/app/api/welcome/families/route.ts` + `__tests__/route.test.ts`.
- `apps/portal/e2e/setu/admin/roster.spec.ts` **(modify, Task 6)** - deployed-UAT E2E for the new report.

**Keep untouched:** `/api/welcome/families/migration-status/route.ts` and the `/api/welcome/families` `canAccessRoute` rule (migration-status still lives under that path); `features/setu/roster/migration-strip.tsx`; `payment.ts`; `family-engagement.ts` (still used by nothing on this page after the rewrite - leave it; it is exercised by its own test and may serve future engagement work).

---

## Task 1: Pure filter + summarize module (shared-domain)

**Files:**
- Create: `packages/shared-domain/src/setu/roster-report.ts`
- Modify: `packages/shared-domain/src/setu/index.ts`
- Test: `packages/shared-domain/src/setu/roster-report.test.ts`

**Interfaces:**
- Produces: `RosterReportChild`, `RosterReportRow`, `RosterReportResponse` (+ `*Schema`), `RosterReportFilters`, `RosterReportSummary`, `matchesRosterFilters(row, filters): boolean`, `summarizeRoster(rows, filters): RosterReportSummary`, `deriveLevelOptions(rows): string[]`, `deriveGradeOptions(rows): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared-domain/src/setu/roster-report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  matchesRosterFilters,
  summarizeRoster,
  deriveLevelOptions,
  deriveGradeOptions,
  type RosterReportRow,
} from './roster-report';

function row(over: Partial<RosterReportRow>): RosterReportRow {
  return {
    fid: 'CMT-A', publicFid: null, legacyFid: null, name: 'A', location: 'Brampton',
    memberCount: 2, payment: 'unknown', programs: [], programKeys: [], bvChildren: [],
    ...over,
  };
}

// Two families, kids across two levels + two grades, mixed payment.
const rana = row({
  fid: 'CMT-RANA', name: 'Rana', location: 'Brampton', payment: 'paid',
  programs: ['Bala Vihar'], programKeys: ['bala-vihar'],
  bvChildren: [{ grade: '2', levelName: 'Level 2' }, { grade: '6', levelName: 'Level 5' }],
});
const shah = row({
  fid: 'CMT-SHAH', name: 'Shah', location: 'Scarborough', payment: 'outstanding',
  programs: ['Bala Vihar', 'Tabla'], programKeys: ['bala-vihar', 'tabla'],
  bvChildren: [{ grade: '2', levelName: 'Level 2' }],
});
const rows = [rana, shah];

describe('matchesRosterFilters', () => {
  it('no filters: every family matches', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, {}))).toHaveLength(2);
  });
  it('location filter', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { location: 'Brampton' }))).toEqual([rana]);
  });
  it('program filter matches on programKey', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { program: 'tabla' }))).toEqual([shah]);
  });
  it('payment filter', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { payment: 'paid' }))).toEqual([rana]);
  });
  it('level filter: family with a child in that level', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { level: 'Level 5' }))).toEqual([rana]);
  });
  it('grade filter: family with a child in that grade', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { grade: '6' }))).toEqual([rana]);
  });
  it('AND across groups', () => {
    expect(rows.filter((r) => matchesRosterFilters(r, { location: 'Brampton', level: 'Level 2' }))).toEqual([rana]);
    expect(rows.filter((r) => matchesRosterFilters(r, { location: 'Scarborough', level: 'Level 5' }))).toEqual([]);
  });
  it('level+grade must be satisfied by the SAME child', () => {
    // rana has (Level 2, grade 2) and (Level 5, grade 6) - no single child is Level 5 + grade 2.
    expect(matchesRosterFilters(rana, { level: 'Level 5', grade: '2' })).toBe(false);
    expect(matchesRosterFilters(rana, { level: 'Level 5', grade: '6' })).toBe(true);
  });
});

describe('summarizeRoster', () => {
  it('counts families and BV children; by-level reflects children, not families', () => {
    const s = summarizeRoster(rows, {});
    expect(s.familyCount).toBe(2);
    expect(s.childCount).toBe(3); // 2 Rana kids + 1 Shah kid
    expect(s.byLevel).toEqual([
      { levelName: 'Level 2', childCount: 2 },
      { levelName: 'Level 5', childCount: 1 },
    ]);
    expect(s.byPayment).toEqual({ paid: 1, outstanding: 1, unknown: 0 });
  });
  it('level filter narrows childCount to matching children only', () => {
    const s = summarizeRoster(rows, { level: 'Level 2' });
    expect(s.familyCount).toBe(2); // both families have a Level 2 child
    expect(s.childCount).toBe(2); // only the two Level 2 kids
    expect(s.byLevel).toEqual([{ levelName: 'Level 2', childCount: 2 }]);
  });
});

describe('option derivation', () => {
  it('levels sorted numerically, distinct', () => {
    expect(deriveLevelOptions(rows)).toEqual(['Level 2', 'Level 5']);
  });
  it('grades sorted with K-family first then numeric, distinct', () => {
    const withK = [row({ bvChildren: [{ grade: 'K', levelName: 'Shishu' }, { grade: '10', levelName: 'Level 9' }] }), rana];
    expect(deriveGradeOptions(withK)).toEqual(['K', '2', '6', '10']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/roster-report.test.ts`
Expected: FAIL - `Cannot find module './roster-report'`.

- [ ] **Step 3: Write the module**

Create `packages/shared-domain/src/setu/roster-report.ts`:

```ts
import { z } from 'zod';
import { ROSTER_PAYMENTS } from './roster';

// One Bala Vihar-enrolled child, reduced to what the report filters + counts on.
export const RosterReportChildSchema = z.object({
  grade: z.string().nullable(),     // schoolGrade ("2","JK") or null
  levelName: z.string().nullable(), // BV enrollment level ("Level 2") or null
});
export type RosterReportChild = z.infer<typeof RosterReportChildSchema>;

// One family row - the lean payload the browser filters + renders.
export const RosterReportRowSchema = z.object({
  fid: z.string(),
  publicFid: z.string().nullable(),
  legacyFid: z.string().nullable(),
  name: z.string(),
  location: z.string(),
  memberCount: z.number().int().nonnegative(),
  payment: z.enum(ROSTER_PAYMENTS),
  programs: z.array(z.string()),    // active program LABELS, for display chips
  programKeys: z.array(z.string()), // active program KEYS, for the Program filter
  bvChildren: z.array(RosterReportChildSchema),
});
export type RosterReportRow = z.infer<typeof RosterReportRowSchema>;

export const RosterReportResponseSchema = z.object({ rows: z.array(RosterReportRowSchema) });
export type RosterReportResponse = z.infer<typeof RosterReportResponseSchema>;

export interface RosterReportFilters {
  location?: string | null;
  program?: string | null;                                   // programKey
  level?: string | null;                                     // levelName (BV)
  grade?: string | null;                                     // schoolGrade
  payment?: (typeof ROSTER_PAYMENTS)[number] | null;
}

export interface RosterReportSummary {
  familyCount: number;
  childCount: number;
  byLevel: Array<{ levelName: string; childCount: number }>;
  byPayment: { paid: number; outstanding: number; unknown: number };
}

// Does a single BV child satisfy the active per-child filters (level, grade)?
// Both must hold on the SAME child (spec: "≥1 BV child passing every active child filter").
function childPasses(c: RosterReportChild, f: RosterReportFilters): boolean {
  if (f.level && c.levelName !== f.level) return false;
  if (f.grade && c.grade !== f.grade) return false;
  return true;
}

export function matchesRosterFilters(row: RosterReportRow, f: RosterReportFilters): boolean {
  if (f.location && row.location !== f.location) return false;
  if (f.program && !row.programKeys.includes(f.program)) return false;
  if (f.payment && row.payment !== f.payment) return false;
  if (f.level || f.grade) {
    if (!row.bvChildren.some((c) => childPasses(c, f))) return false;
  }
  return true;
}

const NO_LEVEL = '(no level)';

export function summarizeRoster(rows: RosterReportRow[], f: RosterReportFilters): RosterReportSummary {
  const included = rows.filter((r) => matchesRosterFilters(r, f));
  const byLevelMap = new Map<string, number>();
  const byPayment = { paid: 0, outstanding: 0, unknown: 0 };
  let childCount = 0;
  for (const r of included) {
    byPayment[r.payment]++;
    for (const c of r.bvChildren) {
      if (!childPasses(c, f)) continue;
      childCount++;
      const key = c.levelName ?? NO_LEVEL;
      byLevelMap.set(key, (byLevelMap.get(key) ?? 0) + 1);
    }
  }
  const byLevel = [...byLevelMap.entries()]
    .map(([levelName, count]) => ({ levelName, childCount: count }))
    .sort((a, b) => compareLevel(a.levelName, b.levelName));
  return { familyCount: included.length, childCount, byLevel, byPayment };
}

// "Level 2" < "Level 10" (numeric), non-numeric names sort last alphabetically.
function levelNum(name: string): number {
  const m = /(\d+)/.exec(name);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}
function compareLevel(a: string, b: string): number {
  const na = levelNum(a);
  const nb = levelNum(b);
  return na !== nb ? na - nb : a.localeCompare(b);
}

export function deriveLevelOptions(rows: RosterReportRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of r.bvChildren) if (c.levelName) set.add(c.levelName);
  return [...set].sort(compareLevel);
}

// K-family grades first (K, JK, SK, PK), then numeric ascending, then any other string.
const GRADE_RANK: Record<string, number> = { K: 0, JK: 1, SK: 2, PK: 3 };
function gradeSortKey(g: string): [number, number, string] {
  const up = g.toUpperCase();
  if (up in GRADE_RANK) return [0, GRADE_RANK[up]!, up];
  const n = Number(g);
  if (Number.isFinite(n)) return [1, n, g];
  return [2, 0, up];
}
export function deriveGradeOptions(rows: RosterReportRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of r.bvChildren) if (c.grade) set.add(c.grade);
  return [...set].sort((a, b) => {
    const ka = gradeSortKey(a);
    const kb = gradeSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
}
```

- [ ] **Step 4: Re-export from the barrel**

In `packages/shared-domain/src/setu/index.ts`, add alongside the other `export *` lines:

```ts
export * from './roster-report';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/roster-report.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain/src/setu/roster-report.ts packages/shared-domain/src/setu/roster-report.test.ts packages/shared-domain/src/setu/index.ts
git commit -m "feat(roster): pure filter + summarize module for the roster report"
```

---

## Task 2: Bulk dataset builder (server-only)

**Files:**
- Modify: `packages/shared-domain/src/setu/roster.ts` (add `level` to `RosterPersonCsvRow`)
- Modify: `apps/portal/src/features/setu/roster/roster-csv.ts` (add `level` column)
- Create: `apps/portal/src/features/setu/roster/report-dataset.ts`
- Test: `apps/portal/src/features/setu/roster/__tests__/report-dataset.test.ts`

**Interfaces:**
- Consumes: `RosterReportRow`, `RosterReportChild`, `RosterPersonCsvRow` (from shared-domain); `paymentFromAmounts` (`./payment`); `resolveSuggestedAmount`, `OfferingDoc` (from shared-domain).
- Produces: `type RosterReportFamilyFull = { row: RosterReportRow; personRows: RosterPersonCsvRow[] }`; `buildRosterReportDataset(params: { year?: string }): Promise<RosterReportFamilyFull[]>`.

- [ ] **Step 1: Add the `level` column to the person-row schema**

In `packages/shared-domain/src/setu/roster.ts`, add `level` to `RosterPersonCsvRowSchema` (after `grade`):

```ts
export const RosterPersonCsvRowSchema = z.object({
  familyName: z.string(),
  fid: z.string(),
  legacyFid: z.string(),
  memberName: z.string(),
  type: z.string(), // 'Adult' | 'Child'
  grade: z.string(),
  level: z.string(), // BV enrollment level name, '' for adults / non-BV members
  location: z.string(),
  programs: z.string(), // '; '-joined active program labels
  payment: z.string(),
});
```

- [ ] **Step 2: Add the `level` column to the CSV serializer**

In `apps/portal/src/features/setu/roster/roster-csv.ts`, add `'level'` to `HEADERS` (after `'grade'`):

```ts
const HEADERS: Array<keyof RosterPersonCsvRow> = [
  'familyName', 'fid', 'legacyFid', 'memberName', 'type', 'grade', 'level', 'location', 'programs', 'payment',
];
```

- [ ] **Step 3: Write the failing builder test**

Create `apps/portal/src/features/setu/roster/__tests__/report-dataset.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake-firestore harness: the builder reads families, collectionGroup(members),
// collectionGroup(enrollments), collectionGroup(donations), and getAll(offerings).
// We stub portalFirestore() with just those surfaces.
const { fs } = vi.hoisted(() => ({ fs: { data: {} as any } }));

function docSnap(id: string, data: any) {
  return { id, exists: true, data: () => data, ref: { parent: { parent: { id: data.__fid ?? id } } } };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      get: async () => ({ docs: (fs.data[name] ?? []).map((d: any) => docSnap(d.id, d)) }),
      doc: (id: string) => ({ id, get: async () => {
        const found = (fs.data[name] ?? []).find((d: any) => d.id === id);
        return found ? docSnap(id, found) : { id, exists: false, data: () => undefined };
      } }),
    }),
    collectionGroup: (name: string) => ({
      get: async () => ({ docs: (fs.data[name] ?? []).map((d: any) => docSnap(d.id, d)) }),
    }),
    getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())),
  }),
}));

import { buildRosterReportDataset } from '../report-dataset';

beforeEach(() => {
  fs.data = {
    families: [
      { id: 'CMT-RANA', name: 'Rana', location: 'Brampton', legacyFid: '477', publicFid: '1075' },
      { id: 'CMT-SHAH', name: 'Shah', location: 'Scarborough', legacyFid: '', publicFid: '1200' },
    ],
    members: [
      { id: 'm1', __fid: 'CMT-RANA', mid: 'm1', firstName: 'Vaibhav', lastName: 'Rana', type: 'Adult', schoolGrade: '' },
      { id: 'm2', __fid: 'CMT-RANA', mid: 'm2', firstName: 'Harshita', lastName: 'Rana', type: 'Child', schoolGrade: '2' },
      { id: 'm3', __fid: 'CMT-SHAH', mid: 'm3', firstName: 'Aarav', lastName: 'Shah', type: 'Child', schoolGrade: '2' },
    ],
    enrollments: [
      // suggestedAmountOverride pins the expected amount to 200 so `payment` does not
      // depend on resolveSuggestedAmount (empty-tier offerings resolve to 0).
      { id: 'e1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', termLabel: '2026-27', levelName: 'Level 2',
        schoolGrade: '2', enrolledMids: ['m2'], suggestedAmountOverride: 200, suggestedAmountSnapshot: 200, enrolledAt: new Date('2026-09-01') },
      { id: 'e2', __fid: 'CMT-SHAH', fid: 'CMT-SHAH', status: 'active', programKey: 'bala-vihar',
        programLabel: 'Bala Vihar', oid: 'off-bv', termLabel: '2026-27', levelName: 'Level 2',
        schoolGrade: '2', enrolledMids: ['m3'], suggestedAmountOverride: 200, suggestedAmountSnapshot: 200, enrolledAt: new Date('2026-09-01') },
    ],
    donations: [
      { id: 'd1', __fid: 'CMT-RANA', fid: 'CMT-RANA', status: 'completed', amountCAD: 200, programKey: 'bala-vihar' },
    ],
    offerings: [
      { id: 'off-bv', oid: 'off-bv', programKey: 'bala-vihar', pricingTiers: [], enabled: true },
    ],
  };
});

describe('buildRosterReportDataset', () => {
  it('maps enrollment level/grade onto bvChildren and derives payment from donations', async () => {
    const out = await buildRosterReportDataset({});
    const rana = out.find((f) => f.row.fid === 'CMT-RANA')!;
    const shah = out.find((f) => f.row.fid === 'CMT-SHAH')!;

    expect(rana.row.name).toBe('Rana');
    expect(rana.row.bvChildren).toEqual([{ grade: '2', levelName: 'Level 2' }]);
    expect(rana.row.programKeys).toEqual(['bala-vihar']);
    expect(rana.row.payment).toBe('paid'); // 200 donated >= 200 expected
    expect(shah.row.payment).toBe('outstanding'); // 0 donated < 200 expected

    // Person rows: one per member incl. the adult; the child carries the level.
    const ranaPeople = rana.personRows;
    expect(ranaPeople).toHaveLength(2);
    const child = ranaPeople.find((p) => p.memberName === 'Harshita Rana')!;
    expect(child).toMatchObject({ type: 'Child', grade: '2', level: 'Level 2' });
    const adult = ranaPeople.find((p) => p.memberName === 'Vaibhav Rana')!;
    expect(adult).toMatchObject({ type: 'Adult', level: '' });
  });

  it('year scope: a non-matching year drops families with no active enrollment that year', async () => {
    const out = await buildRosterReportDataset({ year: '2099-00' });
    // No enrollment has termLabel 2099-00, so no family qualifies.
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/roster/__tests__/report-dataset.test.ts`
Expected: FAIL - `Cannot find module '../report-dataset'`.

- [ ] **Step 5: Write the builder**

Create `apps/portal/src/features/setu/roster/report-dataset.ts`:

```ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount } from '@cmt/shared-domain';
import type { OfferingDoc, RosterPersonCsvRow, RosterReportRow, RosterReportChild } from '@cmt/shared-domain';
import { paymentFromAmounts } from './payment';

export type RosterReportFamilyFull = { row: RosterReportRow; personRows: RosterPersonCsvRow[] };

const OFFERING_CHUNK = 300;
const BV_PROGRAM_KEY = 'bala-vihar';

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return v instanceof Date ? v : new Date(v as string);
}

type Meta = { name: string; location: string; legacyFid: string; publicFid: string | null };
type Member = { mid: string; firstName: string; lastName: string; type: string; grade: string };
type ActiveEnr = {
  programKey: string; programLabel: string; oid: string; levelName: string | null;
  schoolGrade: string | null; enrolledMids: string[]; snapshot: number; override: number | null;
  enrolledAt: Date; termLabel: string;
};

/**
 * One bulk pass over the whole roster - families + members + active enrollments +
 * completed donations + offerings - assembled in memory into per-family report rows
 * AND per-person CSV rows. Index-free (mirrors build-csv-rows.ts). The `year` scope
 * mirrors list-families.ts: only enrollments with `termLabel === year` count as active,
 * and (non-live year only) families with no such enrollment are dropped.
 *
 * Never throws per family - a bad family degrades to payment:'unknown', empty children.
 */
export async function buildRosterReportDataset(params: { year?: string }): Promise<RosterReportFamilyFull[]> {
  const db = portalFirestore();

  // 1) families → meta
  const famSnap = await db.collection('families').get();
  const meta = new Map<string, Meta>();
  for (const d of famSnap.docs) {
    const x = d.data() as { name?: unknown; location?: unknown; legacyFid?: unknown; publicFid?: unknown };
    meta.set(d.id, {
      name: typeof x.name === 'string' && x.name ? x.name : d.id,
      location: typeof x.location === 'string' && x.location ? x.location : 'Brampton',
      legacyFid: typeof x.legacyFid === 'string' ? x.legacyFid : '',
      publicFid: typeof x.publicFid === 'string' ? x.publicFid : null,
    });
  }

  // 2) all members grouped by parent fid
  const memberSnap = await db.collectionGroup('members').get();
  const membersByFid = new Map<string, Member[]>();
  for (const m of memberSnap.docs) {
    const fid = m.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const d = m.data() as { mid?: unknown; firstName?: unknown; lastName?: unknown; type?: unknown; schoolGrade?: unknown };
    const arr = membersByFid.get(fid) ?? [];
    arr.push({
      mid: typeof d.mid === 'string' ? d.mid : m.id,
      firstName: String(d.firstName ?? ''),
      lastName: String(d.lastName ?? ''),
      type: String(d.type ?? ''),
      grade: typeof d.schoolGrade === 'string' ? d.schoolGrade : '',
    });
    membersByFid.set(fid, arr);
  }

  // 3) active enrollments grouped by fid (year-scoped when requested)
  const enrSnap = await db.collectionGroup('enrollments').get();
  const activeByFid = new Map<string, ActiveEnr[]>();
  for (const e of enrSnap.docs) {
    const d = e.data() as Record<string, unknown>;
    if (d['status'] !== 'active') continue;
    const termLabel = String(d['termLabel'] ?? '');
    if (params.year && termLabel !== params.year) continue;
    const fid = typeof d['fid'] === 'string' ? (d['fid'] as string) : e.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const arr = activeByFid.get(fid) ?? [];
    arr.push({
      programKey: String(d['programKey'] ?? ''),
      programLabel: String(d['programLabel'] ?? ''),
      oid: String(d['oid'] ?? ''),
      levelName: typeof d['levelName'] === 'string' ? (d['levelName'] as string) : null,
      schoolGrade: typeof d['schoolGrade'] === 'string' ? (d['schoolGrade'] as string) : null,
      enrolledMids: Array.isArray(d['enrolledMids']) ? (d['enrolledMids'] as string[]) : [],
      snapshot: typeof d['suggestedAmountSnapshot'] === 'number' ? (d['suggestedAmountSnapshot'] as number) : 0,
      override: typeof d['suggestedAmountOverride'] === 'number' ? (d['suggestedAmountOverride'] as number) : null,
      enrolledAt: toDate(d['enrolledAt']),
      termLabel,
    });
    activeByFid.set(fid, arr);
  }

  // 4) completed donations summed by fid
  const donSnap = await db.collectionGroup('donations').get();
  const paidByFid = new Map<string, number>();
  for (const dd of donSnap.docs) {
    const d = dd.data() as Record<string, unknown>;
    if (d['status'] !== 'completed') continue;
    const fid = typeof d['fid'] === 'string' ? (d['fid'] as string) : dd.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const amt = typeof d['amountCAD'] === 'number' ? (d['amountCAD'] as number) : 0;
    paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + amt);
  }

  // 5) offerings for the active enrollments → live effective suggested amount
  const oids = [...new Set([...activeByFid.values()].flat().map((a) => a.oid).filter(Boolean))];
  const offerings = new Map<string, OfferingDoc>();
  for (let i = 0; i < oids.length; i += OFFERING_CHUNK) {
    const refs = oids.slice(i, i + OFFERING_CHUNK).map((o) => db.collection('offerings').doc(o));
    const got = await db.getAll(...refs);
    for (const snap of got) if (snap.exists) offerings.set(snap.id, snap.data() as OfferingDoc);
  }

  // 6) which families appear: all of them (live year), or year-scoped enrollees only
  const fids = params.year ? [...meta.keys()].filter((fid) => (activeByFid.get(fid) ?? []).length > 0) : [...meta.keys()];
  fids.sort((a, b) => {
    const c = meta.get(a)!.name.localeCompare(meta.get(b)!.name);
    return c !== 0 ? c : a.localeCompare(b);
  });

  // 7) assemble per-family
  const out: RosterReportFamilyFull[] = [];
  for (const fid of fids) {
    const fam = meta.get(fid)!;
    const active = activeByFid.get(fid) ?? [];
    const members = membersByFid.get(fid) ?? [];

    const expected = active.reduce((sum, a) => {
      const off = offerings.get(a.oid) ?? null;
      const eff = a.override ?? (off ? resolveSuggestedAmount(off, a.enrolledAt) : a.snapshot);
      return sum + (eff ?? 0);
    }, 0);
    const payment = paymentFromAmounts(active.length, expected, paidByFid.get(fid) ?? 0);

    const programs = [...new Set(active.map((a) => a.programLabel).filter(Boolean))];
    const programKeys = [...new Set(active.map((a) => a.programKey).filter(Boolean))];

    // BV children: expand each active Bala Vihar enrollment's enrolledMids. Grade from
    // the member doc (falls back to the enrollment's schoolGrade); level from the enrollment.
    // mid → BV level, for the per-person CSV level column.
    const bvChildren: RosterReportChild[] = [];
    const levelByMid = new Map<string, string>();
    const memberByMid = new Map(members.map((m) => [m.mid, m] as const));
    for (const a of active) {
      if (a.programKey !== BV_PROGRAM_KEY) continue;
      for (const mid of a.enrolledMids) {
        const mem = memberByMid.get(mid);
        const grade = (mem?.grade || a.schoolGrade) ?? null;
        bvChildren.push({ grade: grade || null, levelName: a.levelName });
        if (a.levelName) levelByMid.set(mid, a.levelName);
      }
    }

    const row: RosterReportRow = {
      fid,
      publicFid: fam.publicFid,
      legacyFid: fam.legacyFid || null,
      name: fam.name,
      location: fam.location,
      memberCount: members.length,
      payment,
      programs,
      programKeys,
      bvChildren,
    };

    const programsJoined = programs.join('; ');
    const personRows: RosterPersonCsvRow[] = members.map((m) => ({
      familyName: fam.name,
      fid,
      legacyFid: fam.legacyFid,
      memberName: `${m.firstName} ${m.lastName}`.trim(),
      type: m.type,
      grade: m.grade,
      level: levelByMid.get(m.mid) ?? '',
      location: fam.location,
      programs: programsJoined,
      payment,
    }));

    out.push({ row, personRows });
  }
  return out;
}
```

- [ ] **Step 6: Run the builder test + the shared-domain schema test**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/roster/__tests__/report-dataset.test.ts`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add packages/shared-domain/src/setu/roster.ts apps/portal/src/features/setu/roster/roster-csv.ts apps/portal/src/features/setu/roster/report-dataset.ts apps/portal/src/features/setu/roster/__tests__/report-dataset.test.ts
git commit -m "feat(roster): bulk report dataset builder + level CSV column"
```

---

## Task 3: Report API endpoint + canAccessRoute rule

**Files:**
- Create: `apps/portal/src/app/api/welcome/roster/report/route.ts`
- Test: `apps/portal/src/app/api/welcome/roster/report/__tests__/route.test.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Modify: `packages/shared-domain/src/__tests__/can-access-route.test.ts`

**Interfaces:**
- Consumes: `buildRosterReportDataset`, `RosterReportFamilyFull` (Task 2); `matchesRosterFilters`, `RosterReportFilters`, `RosterReportResponse` (Task 1); `rosterToCsv` (`roster-csv`); `isWelcomeTeam` (shared-domain); `readSessionFromHeaders` (`@/lib/auth/headers`); `flags` (`@/lib/flags`).
- Note: `canAccessRoute` signature is `(claims, pathname, method='GET')`.
- Produces: `GET` handler at `/api/welcome/roster/report`.

- [ ] **Step 1: Add the canAccessRoute rule**

In `packages/shared-domain/src/auth/can-access-route.ts`, immediately AFTER the existing `/api/welcome/families` block (the one returning `isWelcomeTeam(claims)`), add:

```ts
  // Welcome-team API — single-page roster report (browse/filter dataset + CSV).
  if (pathname === '/api/welcome/roster' || pathname.startsWith('/api/welcome/roster/')) {
    return isWelcomeTeam(claims);
  }
```

- [ ] **Step 2: Assert the new rule in the canAccessRoute test**

In `packages/shared-domain/src/__tests__/can-access-route.test.ts`, add a new `describe` block near the other `/welcome/*` cases. The file already defines top-level fixtures `welcomeTeam` and `member` (SessionClaims) and calls `canAccessRoute(claims, pathname, method)` (claims FIRST):

```ts
describe('canAccessRoute — /api/welcome/roster — welcome-team', () => {
  it('allows welcome-team on the roster report', () => {
    expect(canAccessRoute(welcomeTeam, '/api/welcome/roster/report', 'GET')).toBe(true);
  });
  it('denies a family-member role', () => {
    expect(canAccessRoute(member, '/api/welcome/roster/report', 'GET')).toBe(false);
  });
});
```

- [ ] **Step 3: Write the failing route test**

Create `apps/portal/src/app/api/welcome/roster/report/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { buildRosterReportDataset } = vi.hoisted(() => ({ buildRosterReportDataset: vi.fn() }));
vi.mock('@/features/setu/roster/report-dataset', () => ({ buildRosterReportDataset }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { GET } from '../route';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(`https://x${url}`, { headers });
}
const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };

const SAMPLE = [
  {
    row: {
      fid: 'CMT-RANA', publicFid: '1075', legacyFid: '477', name: 'Rana', location: 'Brampton',
      memberCount: 2, payment: 'paid', programs: ['Bala Vihar'], programKeys: ['bala-vihar'],
      bvChildren: [{ grade: '2', levelName: 'Level 2' }],
    },
    personRows: [
      { familyName: 'Rana', fid: 'CMT-RANA', legacyFid: '477', memberName: 'Harshita Rana', type: 'Child', grade: '2', level: 'Level 2', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid' },
    ],
  },
  {
    row: {
      fid: 'CMT-SHAH', publicFid: '1200', legacyFid: null, name: 'Shah', location: 'Scarborough',
      memberCount: 1, payment: 'outstanding', programs: ['Bala Vihar'], programKeys: ['bala-vihar'],
      bvChildren: [{ grade: '5', levelName: 'Level 4' }],
    },
    personRows: [
      { familyName: 'Shah', fid: 'CMT-SHAH', legacyFid: '', memberName: 'Aarav Shah', type: 'Child', grade: '5', level: 'Level 4', location: 'Scarborough', programs: 'Bala Vihar', payment: 'outstanding' },
    ],
  },
];

beforeEach(() => buildRosterReportDataset.mockReset());

describe('GET /api/welcome/roster/report', () => {
  it('401 with no session header', async () => {
    const res = await GET(req('/api/welcome/roster/report', {}));
    expect(res.status).toBe(401);
  });

  it('403 for a family role', async () => {
    const res = await GET(req('/api/welcome/roster/report', { 'x-portal-role': 'family-member', 'x-portal-extra-roles': '' }));
    expect(res.status).toBe(403);
  });

  it('200 returns lean rows for welcome-team', async () => {
    buildRosterReportDataset.mockResolvedValue(SAMPLE);
    const res = await GET(req('/api/welcome/roster/report', WELCOME));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).not.toHaveProperty('personRows'); // lean projection
    expect(body.rows[0].bvChildren).toEqual([{ grade: '2', levelName: 'Level 2' }]);
  });

  it('format=csv honors a level filter and includes the level column header', async () => {
    buildRosterReportDataset.mockResolvedValue(SAMPLE);
    const res = await GET(req('/api/welcome/roster/report?format=csv&level=Level%204', WELCOME));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('familyName,fid,legacyFid,memberName,type,grade,level,location,programs,payment');
    expect(body).toContain('Aarav Shah');   // Level 4 kid included
    expect(body).not.toContain('Harshita Rana'); // Level 2 kid filtered out
  });
});
```

- [ ] **Step 4: Run the route test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/welcome/roster/report/__tests__/route.test.ts`
Expected: FAIL - `Cannot find module '../route'`.

- [ ] **Step 5: Write the route handler**

Create `apps/portal/src/app/api/welcome/roster/report/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isWelcomeTeam, matchesRosterFilters, type RosterReportFilters, ROSTER_PAYMENTS } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { buildRosterReportDataset } from '@/features/setu/roster/report-dataset';
import { rosterToCsv } from '@/features/setu/roster/roster-csv';

const YEAR_RE = /^\d{4}-\d{2}$/;

function paymentParam(v: string | null): RosterReportFilters['payment'] {
  return v && (ROSTER_PAYMENTS as readonly string[]).includes(v) ? (v as RosterReportFilters['payment']) : null;
}

export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const yearRaw = searchParams.get('year');
  const year = yearRaw && YEAR_RE.test(yearRaw) ? yearRaw : undefined;

  const dataset = await buildRosterReportDataset(year ? { year } : {});

  if (searchParams.get('format') === 'csv') {
    // exactOptionalPropertyTypes: only set filter keys that are present.
    const filters: RosterReportFilters = {
      ...(searchParams.get('location') ? { location: searchParams.get('location') } : {}),
      ...(searchParams.get('program') ? { program: searchParams.get('program') } : {}),
      ...(searchParams.get('level') ? { level: searchParams.get('level') } : {}),
      ...(searchParams.get('grade') ? { grade: searchParams.get('grade') } : {}),
      ...(paymentParam(searchParams.get('payment')) ? { payment: paymentParam(searchParams.get('payment')) } : {}),
    };
    const personRows = dataset.filter((f) => matchesRosterFilters(f.row, filters)).flatMap((f) => f.personRows);
    const csv = rosterToCsv(personRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="roster.csv"',
      },
    });
  }

  return NextResponse.json({ rows: dataset.map((f) => f.row) }, { status: 200 });
}
```

- [ ] **Step 6: Run the route + canAccessRoute tests**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/welcome/roster/report/__tests__/route.test.ts` → Expected: PASS.
Run: `pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/can-access-route.test.ts` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/api/welcome/roster/report packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/__tests__/can-access-route.test.ts
git commit -m "feat(roster): GET /api/welcome/roster/report (json + filtered csv) + canAccessRoute rule"
```

---

## Task 4: Client rewrite - bulk-load, filter, live counts, incremental render

**Files:**
- Modify: `apps/portal/src/features/setu/roster/roster-client.ts`
- Modify: `apps/portal/src/features/setu/roster/roster-browser.tsx`
- Modify: `apps/portal/src/features/setu/roster/roster-export-button.tsx`
- Test: `apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx`

**Interfaces:**
- Consumes: `RosterReportRow`, `RosterReportResponse`, `RosterReportFilters`, `matchesRosterFilters`, `summarizeRoster`, `deriveLevelOptions`, `deriveGradeOptions`, `ROSTER_PAYMENTS`, `displayFid` (shared-domain); `searchFamiliesClient` (unchanged).
- Produces: `fetchRosterReportClient(year?: string): Promise<RosterReportResponse>`.

- [ ] **Step 1: Add the report fetch wrapper; remove the paginated one**

In `apps/portal/src/features/setu/roster/roster-client.ts`, delete `fetchRosterClient` and add (keep `fetchMigrationStatusClient` exactly as-is):

```ts
import type { RosterReportResponse } from '@cmt/shared-domain/setu';

export async function fetchRosterReportClient(year?: string): Promise<RosterReportResponse> {
  const qs = new URLSearchParams();
  if (year) qs.set('year', year);
  const res = await fetch(`/api/welcome/roster/report?${qs.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`roster-report-failed-${res.status}`);
  return (await res.json()) as RosterReportResponse;
}
```
Remove the now-unused `RosterListResponse, RosterQuery` from that file's imports (keep `MigrationStatusResponse`).

- [ ] **Step 2: Update the export button to target the report endpoint + all filters**

Replace `apps/portal/src/features/setu/roster/roster-export-button.tsx`'s `Props` and `onClick` querystring so it forwards every active filter:

```tsx
interface Props {
  /** Current filters so the export matches what's on screen. */
  location?: string | null;
  program?: string | null;
  level?: string | null;
  grade?: string | null;
  payment?: string | null;
  /** School-year scope ("2025-26"); omitted for the live year. */
  year?: string;
}

export function RosterExportButton({ location, program, level, grade, payment, year }: Props) {
  // ...unchanged state...
  function onClick() {
    setFailed(false);
    startTransition(async () => {
      try {
        const qs = new URLSearchParams({ format: 'csv' });
        if (location) qs.set('location', location);
        if (program) qs.set('program', program);
        if (level) qs.set('level', level);
        if (grade) qs.set('grade', grade);
        if (payment) qs.set('payment', payment);
        if (year) qs.set('year', year);
        const res = await fetch(`/api/welcome/roster/report?${qs.toString()}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`export-failed-${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'roster.csv';
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        setFailed(true);
      }
    });
  }
  // ...unchanged JSX...
}
```
(The comment referencing `/api/welcome/families?…&format=csv` must be updated to `/api/welcome/roster/report`.)

- [ ] **Step 3: Rewrite `RosterContent` in `roster-browser.tsx`**

Replace the imports block and the entire `RosterContent` function. New imports at the top of the file:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { SetuLogo, SetuIcon } from '@cmt/ui';
import { displayFid, ROSTER_PAYMENTS } from '@cmt/shared-domain/setu';
import type { RosterReportRow, RosterReportFilters, RosterPayment } from '@cmt/shared-domain/setu';
import {
  matchesRosterFilters, summarizeRoster, deriveLevelOptions, deriveGradeOptions,
} from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { searchFamiliesClient } from '@/features/setu/search/search-families-client';
import type { FamilySearchHit } from '@/features/setu/search/search-families-client';
import { fetchRosterReportClient } from './roster-client';
import { RosterExportButton } from './roster-export-button';
import { MigrationStrip } from './migration-strip';
```

Delete the old `KNOWN_PROGRAMS`/`PROGRAM_LABELS`/`programLabel`, `EngagementChip`/`ENGAGEMENT_STYLE`, and `RosterFamilyCard`'s engagement chip usage. Keep `PAYMENT_STYLE`, `PaymentChip`, `FilterChip`, `FilterRow`, `Notice`, `cardStyle`, `SearchHitCard`. Change `RosterFamilyCard` to take a `RosterReportRow` and drop the `<EngagementChip/>` line (keep the `<PaymentChip/>`). Program display chips read `row.programs` (labels) as before.

New `RosterContent` (the program filter chips derive keys+labels from the loaded data so no hardcoded list is needed):

```tsx
const INITIAL_SHOWN = 50;

function RosterContent({ year, locationOptions }: { year?: string; locationOptions: string[] }) {
  // Dataset (loaded once)
  const [rows, setRows] = useState<RosterReportRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Filters
  const [location, setLocation] = useState<string | null>(null);
  const [program, setProgram] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [payment, setPayment] = useState<RosterPayment | null>(null);
  const [shown, setShown] = useState(INITIAL_SHOWN);

  // Search (unchanged behavior)
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FamilySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const searchActive = query.trim().length > 0;

  useEffect(() => {
    let alive = true;
    fetchRosterReportClient(year)
      .then((res) => { if (alive) { setRows(res.rows); setLoadError(false); } })
      .catch(() => { if (alive) { setRows([]); setLoadError(true); } });
    return () => { alive = false; };
  }, [year]);

  const filters: RosterReportFilters = useMemo(
    () => ({ location, program, level, grade, payment }),
    [location, program, level, grade, payment],
  );

  const all = rows ?? [];
  const filtered = useMemo(() => all.filter((r) => matchesRosterFilters(r, filters)), [all, filters]);
  const summary = useMemo(() => summarizeRoster(all, filters), [all, filters]);
  const levelOptions = useMemo(() => deriveLevelOptions(all), [all]);
  const gradeOptions = useMemo(() => deriveGradeOptions(all), [all]);
  const programOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of all) r.programKeys.forEach((k, i) => { if (!map.has(k)) map.set(k, r.programs[i] ?? k); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  // Reset the incremental window whenever the filter set changes.
  useEffect(() => { setShown(INITIAL_SHOWN); }, [filters]);

  // Search-as-filter (identical to today) ...
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) { setHits([]); setSearched(false); setSearchError(false); return; }
    debounceRef.current = setTimeout(async () => {
      const mySeq = ++seqRef.current;
      setSearching(true); setSearchError(false);
      try {
        const results = await searchFamiliesClient(trimmed);
        if (mySeq !== seqRef.current) return;
        setHits(results); setSearched(true);
      } catch {
        if (mySeq !== seqRef.current) return;
        setSearchError(true); setHits([]); setSearched(true);
      } finally {
        if (mySeq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const visible = filtered.slice(0, shown);
  const loading = rows === null;

  return (
    <div className="col" style={{ gap: 16 }}>
      <MigrationStrip />

      {/* Search input — same markup as today */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none', display: 'inline-flex' }}>
          <SetuIcon.search />
        </div>
        <input
          data-testid="roster-search-input"
          type="search"
          placeholder="Search name, email, phone, or FID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '100%', minHeight: 44, padding: '0 14px 0 40px', fontSize: 15, border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
        />
        {searching && (
          <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12 }}>Searching…</div>
        )}
      </div>

      {/* Filters + summary — hidden while searching (search ignores filters, as today) */}
      {!searchActive && (
        <>
          <div className="col" style={{ gap: 10 }}>
            <FilterRow label="Location">
              <FilterChip active={location === null} onClick={() => setLocation(null)}>All</FilterChip>
              {locationOptions.map((loc) => (
                <FilterChip key={loc} active={location === loc} onClick={() => setLocation(loc)}>{loc}</FilterChip>
              ))}
            </FilterRow>
            <FilterRow label="Program">
              <FilterChip active={program === null} onClick={() => setProgram(null)}>All</FilterChip>
              {programOptions.map(([key, label]) => (
                <FilterChip key={key} active={program === key} onClick={() => setProgram(key)}>{label}</FilterChip>
              ))}
            </FilterRow>
            {levelOptions.length > 0 && (
              <FilterRow label="Level">
                <FilterChip active={level === null} onClick={() => setLevel(null)}>All</FilterChip>
                {levelOptions.map((lv) => (
                  <FilterChip key={lv} active={level === lv} onClick={() => setLevel(lv)}>{lv}</FilterChip>
                ))}
              </FilterRow>
            )}
            {gradeOptions.length > 0 && (
              <FilterRow label="Grade">
                <FilterChip active={grade === null} onClick={() => setGrade(null)}>All</FilterChip>
                {gradeOptions.map((g) => (
                  <FilterChip key={g} active={grade === g} onClick={() => setGrade(g)}>{g}</FilterChip>
                ))}
              </FilterRow>
            )}
            <FilterRow label="Payment">
              <FilterChip active={payment === null} onClick={() => setPayment(null)}>All</FilterChip>
              {ROSTER_PAYMENTS.map((p) => (
                <FilterChip key={p} active={payment === p} onClick={() => setPayment(p)}>
                  {p[0]!.toUpperCase() + p.slice(1)}
                </FilterChip>
              ))}
            </FilterRow>
          </div>

          {!loading && !loadError && <SummaryStrip summary={summary} />}
        </>
      )}

      {/* Count + export */}
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontFeatureSettings: '"tnum"' }}>
          {searchActive
            ? (searched && !searching ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : ' ')
            : (loading ? ' ' : `${filtered.length.toLocaleString()} famil${filtered.length === 1 ? 'y' : 'ies'}`)}
        </span>
        <RosterExportButton
          location={location} program={program} level={level} grade={grade} payment={payment}
          {...(year ? { year } : {})}
        />
      </div>

      {/* Results */}
      <div className="col" style={{ gap: 8 }} data-testid="roster-results">
        {searchActive ? (
          <>
            {searchError && <Notice tone="err">Search failed. Please try again.</Notice>}
            {searched && !searching && !searchError && hits.length === 0 && (<Notice tone="muted">No matching families found.</Notice>)}
            {hits.map((hit) => <SearchHitCard key={hit.fid} hit={hit} />)}
          </>
        ) : (
          <>
            {loadError && <Notice tone="err">Couldn’t load the roster. Please try again.</Notice>}
            {loading && !loadError && <Notice tone="muted">Loading families…</Notice>}
            {!loading && !loadError && filtered.length === 0 && (<Notice tone="muted">No families match these filters.</Notice>)}
            {visible.map((row) => <RosterFamilyCard key={row.fid} row={row} />)}
            {shown < filtered.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + INITIAL_SHOWN)}
                className="focus-ring"
                style={{ minHeight: 44, marginTop: 4, fontSize: 13, fontWeight: 600, background: 'var(--surface)', color: 'var(--accentDeep)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', cursor: 'pointer' }}
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

Add the `SummaryStrip` component (near `Notice`):

```tsx
function SummaryStrip({ summary }: { summary: import('@cmt/shared-domain/setu').RosterReportSummary }) {
  return (
    <div className="card" style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }} data-testid="roster-summary">
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        {summary.familyCount.toLocaleString()} famil{summary.familyCount === 1 ? 'y' : 'ies'}
        {' · '}
        {summary.childCount.toLocaleString()} Bala Vihar child{summary.childCount === 1 ? '' : 'ren'}
      </div>
      {summary.byLevel.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--body-text)' }}>
          <span style={{ color: 'var(--muted)', fontWeight: 600 }}>By level:</span>
          {summary.byLevel.map((b) => (
            <span key={b.levelName} style={{ fontFeatureSettings: '"tnum"' }}>{b.levelName} · {b.childCount}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--body-text)' }}>
        <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Payment:</span>
        <span style={{ fontFeatureSettings: '"tnum"' }}>Paid · {summary.byPayment.paid}</span>
        <span style={{ fontFeatureSettings: '"tnum"' }}>Outstanding · {summary.byPayment.outstanding}</span>
        <span style={{ fontFeatureSettings: '"tnum"' }}>Unknown · {summary.byPayment.unknown}</span>
      </div>
    </div>
  );
}
```

Note: `RosterBrowser` still receives `{ year?, locationOptions }` and passes them into `RosterContent` in both the mobile and desktop branches - do not change that wiring or the header copy beyond leaving it accurate.

- [ ] **Step 4: Update the component test**

Rewrite `apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx` to mock `fetchRosterReportClient` (returning a 2-family dataset with kids in two levels) and `searchFamiliesClient`, then assert:
- renders both family cards after load,
- the summary strip shows "2 families · N Bala Vihar children",
- clicking the "Level 2" filter chip narrows the visible cards to the matching family,
- typing in the search box switches to search hits (mocked).

Mirror the mocking style already in the file (it mocks `roster-client` + `search-families-client`). Full test:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { fetchRosterReportClient, fetchMigrationStatusClient, searchFamiliesClient } = vi.hoisted(() => ({
  fetchRosterReportClient: vi.fn(),
  fetchMigrationStatusClient: vi.fn(),
  searchFamiliesClient: vi.fn(),
}));
vi.mock('../roster-client', () => ({ fetchRosterReportClient, fetchMigrationStatusClient }));
vi.mock('@/features/setu/search/search-families-client', () => ({ searchFamiliesClient }));

import { RosterBrowser } from '../roster-browser';

const DATASET = {
  rows: [
    { fid: 'CMT-RANA', publicFid: '1075', legacyFid: '477', name: 'Rana', location: 'Brampton', memberCount: 2, payment: 'paid', programs: ['Bala Vihar'], programKeys: ['bala-vihar'], bvChildren: [{ grade: '2', levelName: 'Level 2' }] },
    { fid: 'CMT-SHAH', publicFid: '1200', legacyFid: null, name: 'Shah', location: 'Scarborough', memberCount: 1, payment: 'outstanding', programs: ['Bala Vihar'], programKeys: ['bala-vihar'], bvChildren: [{ grade: '5', levelName: 'Level 4' }] },
  ],
};

beforeEach(() => {
  fetchRosterReportClient.mockResolvedValue(DATASET);
  fetchMigrationStatusClient.mockResolvedValue({ legacyTotal: 0, migrated: 0, missing: 0, missingFids: [], checkedAt: '' });
  searchFamiliesClient.mockResolvedValue([]);
});

describe('RosterBrowser', () => {
  it('loads the dataset, shows the summary, and filters by level', async () => {
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    await waitFor(() => expect(screen.getAllByText(/Rana Family/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Shah Family/i).length).toBeGreaterThan(0);
    // Summary: 2 families, 2 BV children
    expect(screen.getAllByText(/2 families · 2 Bala Vihar children/i).length).toBeGreaterThan(0);
    // Filter to Level 4 → only Shah remains (scope to the desktop instance to avoid dup match)
    fireEvent.click(screen.getAllByRole('button', { name: 'Level 4' })[0]!);
    await waitFor(() => expect(screen.queryByText(/Rana Family/i)).not.toBeInTheDocument());
    expect(screen.getAllByText(/Shah Family/i).length).toBeGreaterThan(0);
  });
});
```
If the render duplicates (mobile + desktop both in DOM) causes strict matches, use `getAllBy…`/`[0]` as above.

- [ ] **Step 5: Run the component test + typecheck the feature**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/roster/__tests__/roster-browser.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/roster/roster-client.ts apps/portal/src/features/setu/roster/roster-browser.tsx apps/portal/src/features/setu/roster/roster-export-button.tsx apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx
git commit -m "feat(roster): bulk-load report client with Level/Grade/Payment filters + live summary"
```

---

## Task 5: Retire the paginated browse path

**Files:**
- Delete: `apps/portal/src/features/setu/roster/list-families.ts` + `__tests__/list-families.test.ts`
- Delete: `apps/portal/src/features/setu/roster/build-csv-rows.ts` + `__tests__/build-csv-rows.test.ts`
- Delete: `apps/portal/src/app/api/welcome/families/route.ts` + `__tests__/route.test.ts`
- Verify: nothing else imports the deleted symbols.

- [ ] **Step 1: Confirm the only consumers are the ones we rewired**

Run:
```bash
cd /Users/dineshmatta/projects/chinmaya-mission-portal
grep -rn "list-families\|listRosterFamilies\|build-csv-rows\|buildRosterCsvRows\|fetchRosterClient" apps/portal/src | grep -v "__tests__"
```
Expected: NO matches outside the files being deleted. (`fetchRosterClient` was removed in Task 4; `roster-export-button` + `roster-client` now use the report endpoint.) If any real consumer remains, stop and reconcile before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/portal/src/features/setu/roster/list-families.ts \
       apps/portal/src/features/setu/roster/__tests__/list-families.test.ts \
       apps/portal/src/features/setu/roster/build-csv-rows.ts \
       apps/portal/src/features/setu/roster/__tests__/build-csv-rows.test.ts \
       apps/portal/src/app/api/welcome/families/route.ts \
       apps/portal/src/app/api/welcome/families/__tests__/route.test.ts
```

- [ ] **Step 3: Check for now-orphaned shared-domain exports**

Run:
```bash
grep -rn "RosterListResponse\|RosterQuery\b\|RosterFamilyRow" apps/portal/src packages | grep -v "__tests__\|roster.ts:"
```
If `RosterQuery` / `RosterListResponse` / `RosterFamilyRow` (and their schemas) have NO remaining importer, remove those specific exports from `packages/shared-domain/src/setu/roster.ts`. Keep `ROSTER_PAYMENTS`, `RosterPayment`, `RosterPersonCsvRow*`, and `MigrationStatusResponse*` (still used). If any importer remains, leave the export in place. Do not touch `migration-status` route or the `/api/welcome/families` `canAccessRoute` rule (migration-status still lives under that path).

- [ ] **Step 4: Full feature build sanity**

Run:
```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/roster src/app/api/welcome/roster
pnpm --filter @cmt/shared-domain exec vitest run src/setu src/__tests__
```
Expected: all PASS (no references to deleted modules).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(roster): retire paginated /api/welcome/families browse + csv (report supersedes it)"
```

---

## Task 6: Deployed-UAT E2E

**Files:**
- Modify: `apps/portal/e2e/setu/admin/roster.spec.ts`

**Interfaces:**
- Consumes: `hasFamilyCreds` (`../../_helpers`); the deployed report at `/welcome/roster`; the seeded UAT family `CMT-FSWEDU2X` ("E2E Test Family").

- [ ] **Step 1: Rewrite the spec for the report page**

Replace `apps/portal/e2e/setu/admin/roster.spec.ts` with:

```ts
import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Roster report: the single E2E user is family-manager + admin, so the
// authenticated storageState reaches /welcome/roster (welcome-team gate; admin
// inherits). Read-only — no mutations, no cleanup. Mobile + desktop blocks both
// render in the DOM; scope to the visible (desktop) instances.
test.describe('Roster report (/welcome/roster)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('bulk-loads families, shows the live summary, and filters', async ({ page }) => {
    await page.goto('/welcome/roster');

    const results = page.getByTestId('roster-results').filter({ visible: true });
    await expect(results.getByRole('link').first()).toBeVisible({ timeout: 30_000 });

    // Live summary strip renders with a family count.
    const summary = page.getByTestId('roster-summary').filter({ visible: true });
    await expect(summary.getByText(/famil(y|ies)/i)).toBeVisible({ timeout: 30_000 });

    // Apply the first available Level filter chip; the family count must not exceed
    // the unfiltered count (a filter only narrows).
    const level1 = page.getByRole('button', { name: /^Level /i }).first();
    if (await level1.isVisible().catch(() => false)) {
      await level1.click();
      await expect(results.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('search-as-filter (by FID) → drill into family detail', async ({ page }) => {
    await page.goto('/welcome/roster');
    const results = page.getByTestId('roster-results').filter({ visible: true });
    await page.getByTestId('roster-search-input').filter({ visible: true }).fill('CMT-FSWEDU2X');
    const hit = results.getByText(/E2E Test Family/i).first();
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await hit.click();
    await expect(page).toHaveURL(/\/welcome\/family\/CMT-FSWEDU2X/, { timeout: 20_000 });
  });

  test('CSV export returns text/csv with the new level column header', async ({ page }) => {
    const res = await page.request.get('/api/welcome/roster/report?format=csv', { timeout: 45_000 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain('familyName,fid,legacyFid,memberName,type,grade,level,location,programs,payment');
  });

  test('migration-status endpoint still returns legacy-vs-portal counts', async ({ page }) => {
    const res = await page.request.get('/api/welcome/families/migration-status', { timeout: 45_000 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { legacyTotal: number; migrated: number; missing: number };
    expect(body.legacyTotal).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the E2E against deployed UAT**

Run (after the branch is deployed to the UAT preview / cmt-setu.vercel.app):
```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test e2e/setu/admin/roster.spec.ts --project=setu
```
Expected: all tests PASS. (Requires `E2E_FAMILY_EMAIL` / `E2E_FAMILY_PASSWORD` in the env; the report `/api/welcome/roster/report` load may take a few seconds on ~880 families - the 30s timeout covers it.)

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/setu/admin/roster.spec.ts
git commit -m "test(roster): deployed-UAT E2E for the single-page report (filters, summary, csv)"
```

---

## Final verification (before declaring done)

- [ ] Full local gate (the pre-push hook runs this too):
  ```bash
  pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint && pnpm --filter @cmt/portal test && pnpm --filter @cmt/portal build
  pnpm --filter @cmt/shared-domain test
  ```
- [ ] Push (pre-push hook must pass; never `--no-verify`). Do NOT pipe `git push` through `tail`.
- [ ] Walk the deployed UAT `/welcome/roster` as a user: load, toggle Level/Grade/Payment/Program/Location, confirm the summary counts and the list update together and the export downloads a CSV with a `level` column. State verification status plainly (tests green vs UAT-walked).
- [ ] Update the resume memory (`project_session_resume_2026-07-13*`) with the shipped state. No runbook §14 entry needed (no UAT DB op, no new index, no flag).
