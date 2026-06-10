# Prasad Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One prasad Sunday per family per school year — auto-assigned around the youngest child's birthday month, self-serve movable, reminded by email+SMS — replacing the weekly signup sheet.

**Architecture:** Rollover-pattern: a pure deterministic engine in `@cmt/shared-domain` (`proposePrasadAssignments`, mirroring `decidePromotion`), a top-level `prasadAssignments` Firestore collection (deterministic id `{pid}-{fid}`, idempotent re-publish), `/admin/prasad` preview→publish screen, family dashboard card + `/family/prasad` move flow, daily reminder cron via the existing SES/SNS `resolveSender()` pipeline.

**Tech Stack:** Next.js 16 App Router, Firestore (Admin SDK), Zod (shared-domain), Vitest, Playwright (vs deployed UAT), AWS SES/SNS.

**Spec:** `docs/superpowers/specs/2026-06-10-prasad-module-design.md` (approved 2026-06-10).

---

## Standing constraints (read first — violations have bitten before)

- **UAT only** for all DB writes/scripts/index deploys (`chinmaya-setu-uat`). NEVER write prod `chinmaya-setu-715b8`. Index deploys to UAT: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` (no `--force` needed on UAT, but NEVER `--force` on prod).
- **Legacy RTDB reads come from the local snapshot** — `RTDB_SNAPSHOT_DIR=.rtdb-snapshot` is set in `apps/portal/.env.local`; `readRtdb()` resolves locally. Never remove that var to "test live".
- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are ON — never assign `undefined` to an optional; use conditional spread.
- **Zod schemas must include every new field** or `safeParse` silently strips it.
- New `/api/setu/*` and `/api/welcome/*` paths need explicit `canAccessRoute` rules BEFORE the `/api/setu/` manager-only catch-all (`packages/shared-domain/src/auth/can-access-route.ts:199-203`).
- Role checks via `isAdmin`/`isWelcomeTeam`/`isSetuFamily`/`isSetuManager` helpers — never `claims.role === '...'`.
- Every screen needs a real mobile branch (`block md:hidden` + `hidden md:block`); anything rendered outside a `CspRoot` ancestor needs `className="csp"` for brand tokens.
- Never declare a function component inside another component (remount/focus-loss) — hoist to module scope.
- Tests ship in the SAME commit as the branching logic they cover.
- After any authorized commit: `git push` in the same turn (pre-push hook = typecheck/lint/test/build gate). Commit author is already configured; end commit messages with the Co-Authored-By trailer used in recent history.
- After the UAT index deploy + backfill run, update `docs/runbooks/production-cutover-checklist.md` §10/§14 in the same turn (Task 14 covers this — don't skip).

## Conscious deviations from the spec (approved scope cuts)

1. **Family-form "Birth month" select is deferred.** The `birthMonth` data path ships end-to-end (schema → members API → lazy-migrate → backfill covers 87%); the visible `<select>` on `/family/members/new` + edit ships as a fast-follow. Engine reads `birthMonth ?? month(birthMonthYear)` so shishu kids with full `birthMonthYear` are covered.
2. **Scarborough calendar is an operational step, not code**: the East dates come from a PDF we don't have. The admin enters them via the existing `/admin/calendar` editor. The prasad preview shows an actionable empty state ("Publish the {location} class calendar first") when a location has no eligible Sundays.

## File structure (where everything lives)

```
packages/shared-domain/src/setu/
  prasad.ts                 # zod schemas, doc types, request bodies (Task 1)
  prasad-engine.ts          # pure proposePrasadAssignments (Task 2)
apps/portal/src/features/setu/prasad/
  constants.ts              # CURRENT_PRASAD_PIDS, MOVE_LOCK_DAYS, dates helpers (Task 5)
  load-engine-input.ts      # Firestore → PrasadEngineInput per pid (Task 5)
  publish-assignments.ts    # preview + publish orchestration (Task 5)
  family-assignment.ts      # family GET / move options / move transaction (Task 7)
  reminder-service.ts       # due-reminder query + send + stamp (Task 12)
  prasad-client.ts          # client fetch wrappers (Task 9/11)
  admin-prasad-screen.tsx   # /admin/prasad client screen (Task 10)
  family-prasad-card.tsx    # dashboard card + move dialog (Task 11)
apps/portal/src/app/admin/prasad/page.tsx + error.tsx          (Task 10)
apps/portal/src/app/family/prasad/page.tsx + error.tsx         (Task 11)
apps/portal/src/app/welcome/prasad/page.tsx + error.tsx        (Task 13)
apps/portal/src/app/api/admin/prasad/{preview,publish,assignment}/route.ts + route.ts (list) (Task 6)
apps/portal/src/app/api/setu/prasad/{route.ts,options/route.ts,move/route.ts}          (Task 8)
apps/portal/src/app/api/welcome/prasad/upcoming/route.ts                               (Task 13)
apps/portal/src/app/api/cron/send-prasad-reminders/route.ts                            (Task 12)
apps/portal/scripts/backfill-birth-months.ts                                           (Task 4)
apps/portal/e2e/setu/admin/prasad.spec.ts                                              (Task 14)
```

---

### Task 1: Shared prasad schemas (`@cmt/shared-domain`)

**Files:**
- Create: `packages/shared-domain/src/setu/prasad.ts`
- Modify: `packages/shared-domain/src/setu/index.ts` (add exports)
- Test: `packages/shared-domain/src/setu/__tests__/prasad-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/setu/__tests__/prasad-schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  PrasadAssignmentDocSchema,
  PrasadConfigDocSchema,
  PrasadPreviewBodySchema,
  PrasadMoveBodySchema,
  PrasadAdminReassignBodySchema,
} from '../prasad';

const baseDoc = {
  paid: 'bv-brampton-2025-26-CMT-ABC',
  pid: 'bv-brampton-2025-26',
  fid: 'CMT-ABC',
  familyName: 'Patel',
  location: 'Brampton',
  date: '2026-03-22',
  youngestMid: 'CMT-ABC-02',
  youngestName: 'Aarav',
  birthMonth: 3,
  reason: 'birthday-month',
  source: 'auto',
  status: 'assigned',
  assignedAt: new Date(),
  movedFrom: null,
  movedAt: null,
  movedBy: null,
  remindedAt: { weekBefore: null, twoDayBefore: null },
};

describe('prasad schemas', () => {
  it('parses a full assignment doc', () => {
    expect(PrasadAssignmentDocSchema.parse(baseDoc).paid).toBe('bv-brampton-2025-26-CMT-ABC');
  });
  it('rejects an off-range birthMonth', () => {
    expect(PrasadAssignmentDocSchema.safeParse({ ...baseDoc, birthMonth: 13 }).success).toBe(false);
  });
  it('rejects a malformed date', () => {
    expect(PrasadAssignmentDocSchema.safeParse({ ...baseDoc, date: '03/22/2026' }).success).toBe(false);
  });
  it('parses config + request bodies', () => {
    expect(PrasadConfigDocSchema.parse({ pid: 'x', capPerSunday: 10, publishedAt: new Date(), publishedBy: 'm1' }).capPerSunday).toBe(10);
    expect(PrasadPreviewBodySchema.parse({ pid: 'x', cap: 10 }).cap).toBe(10);
    expect(PrasadPreviewBodySchema.parse({ pid: 'x' }).cap).toBeUndefined();
    expect(PrasadMoveBodySchema.safeParse({ date: 'nope' }).success).toBe(false);
    expect(PrasadAdminReassignBodySchema.parse({ paid: 'p', date: '2026-03-22' }).date).toBe('2026-03-22');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../prasad'`)

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/prasad-schemas.test.ts`

- [ ] **Step 3: Implement**

```ts
// packages/shared-domain/src/setu/prasad.ts
import { z } from 'zod';

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const BIRTH_MONTH = z.number().int().min(1).max(12);

export const PRASAD_REASONS = ['birthday-month', 'spill', 'no-birth-month'] as const;
export const PRASAD_SOURCES = ['auto', 'family-move', 'admin'] as const;
export const PRASAD_STATUSES = ['assigned', 'cancelled'] as const;

/** prasadAssignments/{paid} — one doc per family per period; paid = `${pid}-${fid}`. */
export const PrasadAssignmentDocSchema = z.object({
  paid: z.string().min(1),
  pid: z.string().min(1),
  fid: z.string().min(1),
  familyName: z.string(),
  location: z.string(),
  date: YMD,
  youngestMid: z.string().nullable(),
  youngestName: z.string().nullable(),
  birthMonth: BIRTH_MONTH.nullable(),
  reason: z.enum(PRASAD_REASONS),
  source: z.enum(PRASAD_SOURCES),
  status: z.enum(PRASAD_STATUSES),
  assignedAt: z.date(),
  movedFrom: YMD.nullable(),
  movedAt: z.date().nullable(),
  movedBy: z.string().nullable(),
  remindedAt: z.object({
    weekBefore: z.date().nullable(),
    twoDayBefore: z.date().nullable(),
  }),
});
export type PrasadAssignmentDoc = z.infer<typeof PrasadAssignmentDocSchema>;

/** prasadConfig/{pid} — the cap the admin published with (move dialog enforces it). */
export const PrasadConfigDocSchema = z.object({
  pid: z.string().min(1),
  capPerSunday: z.number().int().min(1),
  publishedAt: z.date(),
  publishedBy: z.string().min(1),
});
export type PrasadConfigDoc = z.infer<typeof PrasadConfigDocSchema>;

// ---- request bodies (shared web ↔ native) ----
export const PrasadPreviewBodySchema = z.object({
  pid: z.string().min(1),
  cap: z.number().int().min(1).optional(), // omitted → computed default
});
export const PrasadPublishBodySchema = z.object({
  pid: z.string().min(1),
  cap: z.number().int().min(1),
});
export const PrasadMoveBodySchema = z.object({ date: YMD });
export const PrasadAdminReassignBodySchema = z.object({
  paid: z.string().min(1),
  date: YMD.optional(),          // present → reassign to this date
  cancel: z.boolean().optional(), // true → status:'cancelled' (family left)
});
export type PrasadPreviewBody = z.infer<typeof PrasadPreviewBodySchema>;
export type PrasadPublishBody = z.infer<typeof PrasadPublishBodySchema>;
export type PrasadMoveBody = z.infer<typeof PrasadMoveBodySchema>;
export type PrasadAdminReassignBody = z.infer<typeof PrasadAdminReassignBodySchema>;
```

- [ ] **Step 4: Export from the barrel** — in `packages/shared-domain/src/setu/index.ts`, next to the `export * from './set-grade';` line add:

```ts
export * from './prasad';
export * from './prasad-engine';
```

(`prasad-engine` doesn't exist until Task 2 — add only `export * from './prasad';` now, the engine export in Task 2.)

- [ ] **Step 5: Run test — expect PASS**, then commit

```bash
git add packages/shared-domain/src/setu/prasad.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/__tests__/prasad-schemas.test.ts
git commit -m "feat(prasad): shared assignment/config schemas + request bodies"
```

---

### Task 2: Pure assignment engine (TDD — the heart of the module)

**Files:**
- Create: `packages/shared-domain/src/setu/prasad-engine.ts`
- Modify: `packages/shared-domain/src/setu/index.ts` (add `export * from './prasad-engine';`)
- Test: `packages/shared-domain/src/setu/__tests__/prasad-engine.test.ts`

- [ ] **Step 1: Write the failing tests** — these encode every rule from the spec:

```ts
// packages/shared-domain/src/setu/__tests__/prasad-engine.test.ts
import { describe, it, expect } from 'vitest';
import { proposePrasadAssignments, type PrasadEngineInput } from '../prasad-engine';

const sundays = (...dates: string[]) => dates.map((date) => ({ date }));
const child = (mid: string, gradeRung: number | null, birthMonth: number | null, name = mid) =>
  ({ mid, name, gradeRung, birthMonth });
const fam = (
  fid: string,
  children: ReturnType<typeof child>[],
  existing: { date: string } | null = null,
) => ({ fid, familyName: `Fam ${fid}`, children, existing });

function run(input: Partial<PrasadEngineInput>): ReturnType<typeof proposePrasadAssignments> {
  return proposePrasadAssignments({
    pid: 'bv-brampton-2025-26',
    location: 'Brampton',
    cap: 2,
    sundays: sundays('2026-03-01', '2026-03-08', '2026-04-05'),
    families: [],
    ...input,
  });
}

describe('proposePrasadAssignments', () => {
  it('places a family in its youngest child birthday month', () => {
    const out = run({ families: [fam('A', [child('A-02', 3, 3)])] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ fid: 'A', date: '2026-03-01', reason: 'birthday-month', birthMonth: 3 });
  });

  it('youngest = lowest gradeRung; tie broken by lower mid', () => {
    const out = run({
      families: [fam('A', [child('A-03', 1, 4), child('A-02', 1, 3)])],
      sundays: sundays('2026-03-01', '2026-04-05'),
    });
    // tie on rung 1 → A-02 wins → birthMonth 3 → March
    expect(out.rows[0]).toMatchObject({ youngestMid: 'A-02', date: '2026-03-01' });
  });

  it('falls back to the next-youngest child WITH a birth month', () => {
    const out = run({
      families: [fam('A', [child('A-02', 0, null), child('A-03', 5, 4)])],
      sundays: sundays('2026-03-01', '2026-04-05'),
    });
    expect(out.rows[0]).toMatchObject({ date: '2026-04-05', birthMonth: 4, reason: 'birthday-month' });
  });

  it('balances within the month: picks the Sunday with most seats, tie → earliest', () => {
    const out = run({
      cap: 2,
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, 3)]), fam('C', [child('c', 1, 3)])],
      sundays: sundays('2026-03-01', '2026-03-08'),
    });
    const dates = out.rows.map((r) => r.date).sort();
    expect(dates).toEqual(['2026-03-01', '2026-03-01', '2026-03-08']);
  });

  it('spills to the calendar-nearest Sunday when the month is full (equal distance → earlier)', () => {
    const out = run({
      cap: 1,
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, 3)])],
      sundays: sundays('2026-02-22', '2026-03-01', '2026-04-12'),
    });
    const a = out.rows.find((r) => r.fid === 'A')!;
    const b = out.rows.find((r) => r.fid === 'B')!;
    expect(a).toMatchObject({ date: '2026-03-01', reason: 'birthday-month' });
    // March's only Sunday is taken → anchor 2026-03-01; Feb 22 is 7 days away,
    // Apr 12 is 42 → nearest open seat is Feb 22.
    expect(b).toMatchObject({ date: '2026-02-22', reason: 'spill' });
  });

  it('July/August birthdays (no class Sundays) spill to the nearest class Sunday', () => {
    const out = run({
      families: [fam('A', [child('a', 1, 7)])],
      sundays: sundays('2025-09-07', '2026-06-14'),
    });
    expect(out.rows[0]!.reason).toBe('spill');
    expect(['2025-09-07', '2026-06-14']).toContain(out.rows[0]!.date);
  });

  it('no-birth-month families fill the emptiest Sundays', () => {
    const out = run({
      cap: 2,
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, null)])],
      sundays: sundays('2026-03-01', '2026-04-05'),
    });
    expect(out.rows.find((r) => r.fid === 'B')).toMatchObject({ date: '2026-04-05', reason: 'no-birth-month', birthMonth: null });
  });

  it('keeps existing assignments (never moves), their seats are consumed, and they are not re-proposed', () => {
    const out = run({
      cap: 1,
      families: [fam('A', [child('a', 1, 3)], { date: '2026-03-01' }), fam('B', [child('b', 1, 3)])],
      sundays: sundays('2026-03-01', '2026-03-08'),
    });
    expect(out.rows.map((r) => r.fid)).toEqual(['B']);  // A untouched
    expect(out.rows[0]!.date).toBe('2026-03-08');        // A consumed March 1's only seat
    expect(out.stats.keptExisting).toBe(1);
  });

  it('flags unplaceable families when total seats run out', () => {
    const out = run({
      cap: 1,
      sundays: sundays('2026-03-01'),
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, 3)])],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.unplaced.map((u) => u.fid)).toEqual(['B']);
  });

  it('is deterministic: same input → identical output', () => {
    const input: PrasadEngineInput = {
      pid: 'p', location: 'Brampton', cap: 2,
      sundays: sundays('2026-03-01', '2026-03-08', '2026-04-05'),
      families: [fam('C', [child('c', 2, 4)]), fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, null)])],
    };
    expect(proposePrasadAssignments(input)).toEqual(proposePrasadAssignments(input));
  });

  it('reports per-Sunday counts including existing assignments', () => {
    const out = run({
      families: [fam('A', [child('a', 1, 3)], { date: '2026-03-08' }), fam('B', [child('b', 1, 3)])],
    });
    const march1 = out.perSunday.find((s) => s.date === '2026-03-01')!;
    const march8 = out.perSunday.find((s) => s.date === '2026-03-08')!;
    expect(march8.count).toBe(1); // existing
    expect(march1.count).toBe(1); // new proposal balances to the emptier... both at 1 after B placed
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../prasad-engine'`)

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/prasad-engine.test.ts`

- [ ] **Step 3: Implement the engine**

```ts
// packages/shared-domain/src/setu/prasad-engine.ts
import type { PrasadAssignmentDoc } from './prasad';

export interface PrasadEngineChild {
  mid: string;
  name: string;
  /** Ladder index (JK=0, SK=1, Grade n = n+1) or null when grade is unknown. */
  gradeRung: number | null;
  birthMonth: number | null; // 1-12
}

export interface PrasadEngineFamily {
  fid: string;
  familyName: string;
  children: PrasadEngineChild[];
  /** Already-assigned (any source) → kept verbatim, seat consumed. */
  existing: { date: string } | null;
}

export interface PrasadEngineInput {
  pid: string;
  location: string;
  cap: number;
  /** Eligible class Sundays (kind=class, enabled, prasadNeeded, future-only) — caller filters. */
  sundays: Array<{ date: string }>;
  families: PrasadEngineFamily[];
}

export type PrasadProposalRow = Pick<
  PrasadAssignmentDoc,
  'fid' | 'familyName' | 'location' | 'date' | 'youngestMid' | 'youngestName' | 'birthMonth' | 'reason'
>;

export interface PrasadProposal {
  pid: string;
  cap: number;
  rows: PrasadProposalRow[];                       // NEW proposals only (existing excluded)
  unplaced: Array<{ fid: string; familyName: string }>;
  perSunday: Array<{ date: string; count: number }>; // existing + proposed
  stats: {
    families: number;
    keptExisting: number;
    birthdayMonth: number;
    spill: number;
    noBirthMonth: number;
    unplaced: number;
  };
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}
const monthOf = (ymd: string): number => Number(ymd.slice(5, 7));

/** Youngest = lowest gradeRung (null rungs sort last); tie → lower mid. */
function pickTarget(children: PrasadEngineChild[]): { youngest: PrasadEngineChild | null; birthMonth: number | null; carrier: PrasadEngineChild | null } {
  const sorted = [...children].sort((a, b) => {
    const ra = a.gradeRung ?? Number.MAX_SAFE_INTEGER;
    const rb = b.gradeRung ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || a.mid.localeCompare(b.mid);
  });
  const youngest = sorted[0] ?? null;
  const carrier = sorted.find((c) => c.birthMonth != null) ?? null;
  return { youngest, birthMonth: carrier?.birthMonth ?? null, carrier };
}

export function proposePrasadAssignments(input: PrasadEngineInput): PrasadProposal {
  // seats[date] = remaining capacity. Existing assignments consume seats first
  // (even if their date is no longer in `sundays`, they are kept — just not counted
  // against a seat map entry that doesn't exist).
  const seats = new Map<string, number>(input.sundays.map((s) => [s.date, input.cap]));
  const counts = new Map<string, number>(input.sundays.map((s) => [s.date, 0]));
  let keptExisting = 0;

  for (const f of input.families) {
    if (f.existing) {
      keptExisting++;
      if (seats.has(f.existing.date)) {
        seats.set(f.existing.date, Math.max(0, seats.get(f.existing.date)! - 1));
        counts.set(f.existing.date, (counts.get(f.existing.date) ?? 0) + 1);
      }
    }
  }

  const ordered = (dates: string[]): string[] =>
    [...dates].sort((a, b) => (seats.get(b)! - seats.get(a)!) || dayNumber(a) - dayNumber(b));

  const take = (date: string): void => {
    seats.set(date, seats.get(date)! - 1);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  };

  const allDates = input.sundays.map((s) => s.date);
  const rows: PrasadProposalRow[] = [];
  const unplaced: Array<{ fid: string; familyName: string }> = [];
  const stats = { birthdayMonth: 0, spill: 0, noBirthMonth: 0 };

  const unassigned = input.families.filter((f) => !f.existing);
  const withMonth = unassigned
    .map((f) => ({ f, t: pickTarget(f.children) }))
    .filter((x) => x.t.birthMonth != null)
    .sort((a, b) => a.f.fid.localeCompare(b.f.fid));
  const withoutMonth = unassigned
    .map((f) => ({ f, t: pickTarget(f.children) }))
    .filter((x) => x.t.birthMonth == null)
    .sort((a, b) => a.f.fid.localeCompare(b.f.fid));

  const place = (
    f: PrasadEngineFamily,
    t: ReturnType<typeof pickTarget>,
    date: string | undefined,
    reason: PrasadProposalRow['reason'],
  ): void => {
    if (!date) {
      unplaced.push({ fid: f.fid, familyName: f.familyName });
      return;
    }
    take(date);
    if (reason === 'birthday-month') stats.birthdayMonth++;
    else if (reason === 'spill') stats.spill++;
    else stats.noBirthMonth++;
    rows.push({
      fid: f.fid,
      familyName: f.familyName,
      location: input.location,
      date,
      youngestMid: t.youngest?.mid ?? null,
      youngestName: t.youngest?.name ?? null,
      birthMonth: t.birthMonth,
      reason,
    });
  };

  // Pass 1 — birthday-month families.
  for (const { f, t } of withMonth) {
    const inMonth = ordered(allDates.filter((d) => monthOf(d) === t.birthMonth && seats.get(d)! > 0));
    if (inMonth.length > 0) {
      place(f, t, inMonth[0], 'birthday-month');
      continue;
    }
    // Spill: nearest Sunday (by days) with a seat to the middle of the target
    // month within the season; anchor = the 15th of the birth month in the year
    // of the season's median Sunday. Simpler + deterministic: nearest to any
    // in-month Sunday if the month exists on the calendar, else nearest to the
    // month boundary anchor derived from the median season year.
    const anchor = (() => {
      const inMonthAll = allDates.filter((d) => monthOf(d) === t.birthMonth);
      if (inMonthAll.length > 0) return dayNumber(inMonthAll[0]!);
      const median = allDates[Math.floor(allDates.length / 2)]!;
      const year = Number(median.slice(0, 4));
      return Date.UTC(year, t.birthMonth! - 1, 15) / 86_400_000;
    })();
    const candidates = allDates
      .filter((d) => seats.get(d)! > 0)
      .sort((a, b) => {
        const da = Math.abs(dayNumber(a) - anchor);
        const db = Math.abs(dayNumber(b) - anchor);
        return da - db || dayNumber(a) - dayNumber(b);
      });
    place(f, t, candidates[0], 'spill');
  }

  // Pass 2 — no-birth-month families → emptiest Sundays.
  for (const { f, t } of withoutMonth) {
    const open = ordered(allDates.filter((d) => seats.get(d)! > 0));
    place(f, t, open[0], 'no-birth-month');
  }

  return {
    pid: input.pid,
    cap: input.cap,
    rows,
    unplaced,
    perSunday: allDates.map((date) => ({ date, count: counts.get(date) ?? 0 })),
    stats: {
      families: input.families.length,
      keptExisting,
      ...stats,
      unplaced: unplaced.length,
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS.** If the spill test fails on anchor choice, the test is the contract — fix the engine, not the test.

- [ ] **Step 5: Add the barrel export** (`export * from './prasad-engine';` in `setu/index.ts`), run `pnpm --filter @cmt/shared-domain test` (all green), commit:

```bash
git add packages/shared-domain/src/setu/prasad-engine.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/__tests__/prasad-engine.test.ts
git commit -m "feat(prasad): pure deterministic assignment engine (birthday-month + spill + cap)"
```

---

### Task 3: `member.birthMonth` field (schema → API → migration path)

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/member.ts` (after `birthMonthYear`)
- Modify: `apps/portal/src/app/api/setu/members/route.ts:33` area (POST body) + member-doc construction (~line 126)
- Modify: `apps/portal/src/features/setu/registration/legacy-parser.ts` (map `dob_m`)
- Modify: `apps/portal/src/features/setu/registration/lazy-migrate.ts` (write `birthMonth` on child member docs)
- Tests: existing legacy-parser + members-route test files (add cases in the same files)

- [ ] **Step 1: Schema** — in `MemberDocSchema` directly under `birthMonthYear: z.string().nullable(),` add:

```ts
  // Birth month only (1-12), no year — the legacy roster's `dob_m`. Used by the
  // prasad assigner. Derived from birthMonthYear when that exists.
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
```

- [ ] **Step 2: Members API** — in `apps/portal/src/app/api/setu/members/route.ts`, POST body schema (near line 33) add `birthMonth: z.number().int().min(1).max(12).nullish(),` and in the member-doc construction (near line 126) add `birthMonth: data.birthMonth ?? null,`. Mirror the exact `birthMonthYear` handling on the PATCH path if the PATCH schema lists fields individually.

- [ ] **Step 3: Legacy parser** — in `legacy-parser.ts`: add `dob_m?: number | string;` to the roster-row interface; in the child-mapping code (where `schoolGrade`/`legacySid` are produced) add:

```ts
const dobM = Number(row.dob_m);
const birthMonth = Number.isFinite(dobM) && dobM >= 1 && dobM <= 12 ? dobM : null;
```

and carry `birthMonth` on the returned child object (extend the child type).

- [ ] **Step 4: Lazy migrate** — in `lazy-migrate.ts`, where child member docs are constructed from parsed children, add `birthMonth: child.birthMonth ?? null,`.

- [ ] **Step 5: Tests in the same commit** — extend the existing legacy-parser test file with: a row carrying `dob_m: 9` → child `birthMonth === 9`; `dob_m: 'NULL'` → `null`; `dob_m: 0` → `null`. Extend the members-route test with a POST carrying `birthMonth: 5` asserting the written doc got it (follow that file's existing mock conventions).

- [ ] **Step 6: Run** `pnpm --filter @cmt/portal test` + `pnpm --filter @cmt/shared-domain test` — green. Commit:

```bash
git add packages/shared-domain/src/setu/schemas/member.ts apps/portal/src/app/api/setu/members/route.ts apps/portal/src/features/setu/registration/legacy-parser.ts apps/portal/src/features/setu/registration/lazy-migrate.ts <touched test files>
git commit -m "feat(prasad): member.birthMonth (1-12) — schema, members API, legacy dob_m mapping"
```

---

### Task 4: `backfill:birth-months` script (snapshot-fed, UAT-guarded)

**Files:**
- Create: `apps/portal/scripts/backfill-birth-months.ts`
- Modify: `apps/portal/package.json` (alias `"backfill:birth-months": "tsx --env-file=.env.local scripts/backfill-birth-months.ts"`)

- [ ] **Step 1: Write the script** (reads `/roster` ONCE via `readRtdb` — resolves from the local snapshot because `.env.local` sets `RTDB_SNAPSHOT_DIR`):

```ts
// apps/portal/scripts/backfill-birth-months.ts
/**
 * Backfill members.birthMonth (1-12) from the legacy roster's dob_m, matched
 * via members.legacySid. Reads /roster once through readRtdb (local snapshot —
 * zero RTDB downloads). UAT-guarded; idempotent (skips members whose stored
 * birthMonth already equals the roster value).
 *
 * Usage: pnpm --filter @cmt/portal backfill:birth-months [--dry-run] [--limit N] [--fid CMT-X]
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

interface Args { dryRun: boolean; limit: number | null; fid: string | null; allowProd: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, limit: null, fid: null, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--allow-prod') a.allowProd = true;
    else if (v === '--limit') a.limit = Number(argv[++i]);
    else if (v === '--fid') a.fid = argv[++i] ?? null;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const project = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  if (project !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected chinmaya-setu-uat (--allow-prod to bypass).`);
    process.exit(1);
  }

  const roster = (await readRtdb<Record<string, { sid?: string | number; dob_m?: number | string }>>('/roster')) ?? {};
  const monthBySid = new Map<string, number>();
  for (const row of Object.values(roster)) {
    const sid = row.sid != null ? String(row.sid) : null;
    const m = Number(row.dob_m);
    if (sid && Number.isFinite(m) && m >= 1 && m <= 12) monthBySid.set(sid, m);
  }
  console.log(`roster rows with usable dob_m: ${monthBySid.size}`);

  const db = portalFirestore();
  const membersSnap = await db.collectionGroup('members').get();
  let updated = 0, skipped = 0, noMatch = 0, processed = 0;
  for (const doc of membersSnap.docs) {
    const m = doc.data() as { type?: string; legacySid?: string | null; birthMonth?: number | null; mid?: string };
    const fid = doc.ref.parent.parent?.id ?? '';
    if (args.fid && fid !== args.fid) continue;
    if (m.type !== 'Child' || m.legacySid == null) continue;
    if (args.limit !== null && processed >= args.limit) break;
    processed++;
    const month = monthBySid.get(String(m.legacySid));
    if (month == null) { noMatch++; continue; }
    if (m.birthMonth === month) { skipped++; continue; }
    if (!args.dryRun) await doc.ref.set({ birthMonth: month }, { merge: true });
    updated++;
  }
  console.log(`processed=${processed} updated=${updated}${args.dryRun ? ' (dry-run)' : ''} alreadySet=${skipped} noRosterMatch=${noMatch}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the pnpm alias** next to `backfill:bv-enrollments` in `apps/portal/package.json`.

- [ ] **Step 3: Dry-run, then real run against UAT:**

```bash
pnpm --filter @cmt/portal backfill:birth-months -- --dry-run   # expect ~700+ "updated"
pnpm --filter @cmt/portal backfill:birth-months                # real run
pnpm --filter @cmt/portal backfill:birth-months                # re-run → updated=0 (idempotent)
```

- [ ] **Step 4: Commit** (script + alias). Runbook entry lands in Task 14.

```bash
git add apps/portal/scripts/backfill-birth-months.ts apps/portal/package.json
git commit -m "feat(prasad): backfill members.birthMonth from legacy dob_m (snapshot-fed, idempotent)"
```

---

### Task 5: Calendar `prasadNeeded` flag + server feature (loader, preview, publish)

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/class-calendar.ts` (3 schemas)
- Modify: `apps/portal/src/features/admin/calendar/calendar-editor.tsx` (per-row toggle, mirrors `toggleEnabled` at line 109)
- Create: `apps/portal/src/features/setu/prasad/constants.ts`, `load-engine-input.ts`, `publish-assignments.ts`
- Tests: `packages/shared-domain/src/setu/__tests__/class-calendar-schemas.test.ts` (extend), `apps/portal/src/features/setu/prasad/__tests__/publish-assignments.test.ts`

- [ ] **Step 1: Schema additions.** In `ClassCalendarEntryDocSchema` add `prasadNeeded: z.boolean().default(true),`; in `CreateCalendarEntrySchema` add `prasadNeeded: z.boolean().default(true),`; in `UpdateCalendarEntrySchema` add `prasadNeeded: z.boolean().optional(),`. Extend the existing calendar schema test: update parses `{ prasadNeeded: false }`; doc parse defaults missing → `true`.

- [ ] **Step 2: Editor toggle.** In `calendar-editor.tsx`: add `prasadNeeded: boolean;` to `EntryRow` (line ~21, read it as `data.prasadNeeded !== false` where rows are loaded), clone `toggleEnabled` into:

```ts
async function togglePrasadNeeded(row: EntryRow) {
  await fetch(`/api/admin/calendar/${row.entryId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prasadNeeded: !row.prasadNeeded }),
  });
  setEntries((prev) => prev.map((e) => (e.entryId === row.entryId ? { ...e, prasadNeeded: !e.prasadNeeded } : e)));
}
```

and render a pill button beside the Published/Draft pill in BOTH the mobile card branch (~line 229) and the desktop table branch (~line 266): label `Prasad` / `No prasad`, same pill style with `background: e.prasadNeeded ? 'var(--accentSoft)' : 'var(--surface2)'`. Only render it on `kind === 'class'` rows. Verify the `[entryId]` PATCH route validates with `UpdateCalendarEntrySchema` (it does — passthrough is automatic once the schema has the field).

- [ ] **Step 3: Feature constants** — `apps/portal/src/features/setu/prasad/constants.ts`:

```ts
// Active prasad periods per location. Bump both to the new year's pids when
// school-year:start seeds the next calendar (same cadence as rollover).
export const CURRENT_PRASAD_PIDS = [
  { pid: 'bv-brampton-2025-26', location: 'Brampton' },
  { pid: 'bv-scarborough-2025-26', location: 'Scarborough' },
] as const;

export const MOVE_LOCK_DAYS = 7;

/** Toronto-local YYYY-MM-DD for "today" — all date math is calendar-day based. */
export function torontoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
}

export function daysUntil(ymd: string, todayYmd: string): number {
  const n = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86_400_000; };
  return n(ymd) - n(todayYmd);
}
```

- [ ] **Step 4: Engine-input loader** — `load-engine-input.ts`. Mirrors `deriveRoster`'s read pattern (`apps/portal/src/features/setu/teacher/roster.ts:109-163`):

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { GRADE_LADDER, normalizeGrade, type PrasadEngineFamily, type PrasadEngineInput } from '@cmt/shared-domain';
import { torontoToday } from './constants';

const RUNG = new Map<string, number>(GRADE_LADDER.map((g, i) => [normalizeGrade(g), i]));

function gradeRung(schoolGrade: string | null): number | null {
  if (!schoolGrade || schoolGrade.trim() === '') return null;
  return RUNG.get(normalizeGrade(schoolGrade)) ?? null;
}

function monthOfBmy(birthMonthYear: string | null): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(birthMonthYear ?? '');
  return m ? Number(m[1]) : null;
}

export interface LoadedEngineInput {
  input: PrasadEngineInput;
  defaultCap: number;
  eligibleSundayCount: number;
}

/** Load everything proposePrasadAssignments needs for one (pid, location). */
export async function loadEngineInput(pid: string, location: string, cap?: number): Promise<LoadedEngineInput> {
  const db = portalFirestore();
  const todayYmd = torontoToday();

  // 1) Eligible Sundays: class + enabled + prasadNeeded, future-only.
  const calSnap = await db.collection('classCalendarEntries')
    .where('location', '==', location).where('programKey', '==', 'bala-vihar').get();
  const sundays = calSnap.docs
    .map((d) => d.data() as { date: string; kind: string; enabled?: boolean; prasadNeeded?: boolean })
    .filter((e) => e.kind === 'class' && e.enabled !== false && e.prasadNeeded !== false && e.date > todayYmd)
    .map((e) => ({ date: e.date }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 2) Active enrollments for this pid at this location (existing composite
  //    index enrollments(pid,status) COLLECTION_GROUP backs this).
  const enrollSnap = await db.collectionGroup('enrollments')
    .where('pid', '==', pid).where('status', '==', 'active').get();
  const enrolledMidsByFid = new Map<string, Set<string>>();
  for (const d of enrollSnap.docs) {
    const e = d.data() as { fid?: string; location?: string; enrolledMids?: string[] };
    if (e.location !== location || typeof e.fid !== 'string') continue;
    const set = enrolledMidsByFid.get(e.fid) ?? new Set<string>();
    for (const m of e.enrolledMids ?? []) set.add(m);
    enrolledMidsByFid.set(e.fid, set);
  }

  // 3) Existing assignments for this pid (deterministic ids → one query).
  const assignSnap = await db.collection('prasadAssignments').where('pid', '==', pid).get();
  const existingByFid = new Map<string, { date: string }>();
  for (const d of assignSnap.docs) {
    const a = d.data() as { fid: string; date: string; status: string };
    if (a.status === 'assigned') existingByFid.set(a.fid, { date: a.date });
  }

  // 4) Family + member docs (bulk per family — same shape as deriveRoster).
  const fids = [...enrolledMidsByFid.keys()];
  const families: PrasadEngineFamily[] = await Promise.all(fids.map(async (fid) => {
    const [famDoc, memSnap] = await Promise.all([
      db.collection('families').doc(fid).get(),
      db.collection('families').doc(fid).collection('members').get(),
    ]);
    const enrolled = enrolledMidsByFid.get(fid)!;
    const children = memSnap.docs
      .map((d) => d.data() as { mid: string; firstName?: string; lastName?: string; type?: string; schoolGrade?: string | null; birthMonth?: number | null; birthMonthYear?: string | null })
      .filter((m) => m.type === 'Child' && enrolled.has(m.mid))
      .map((m) => ({
        mid: m.mid,
        name: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.mid,
        gradeRung: gradeRung(m.schoolGrade ?? null),
        birthMonth: m.birthMonth ?? monthOfBmy(m.birthMonthYear ?? null),
      }));
    return {
      fid,
      familyName: (famDoc.data()?.name as string | undefined) ?? fid,
      children,
      existing: existingByFid.get(fid) ?? null,
    };
  }));

  const defaultCap = sundays.length > 0 ? Math.ceil(families.length / sundays.length) : 1;
  return {
    input: { pid, location, cap: cap ?? defaultCap, sundays, families },
    defaultCap,
    eligibleSundayCount: sundays.length,
  };
}
```

- [ ] **Step 5: Preview + publish** — `publish-assignments.ts`:

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { proposePrasadAssignments, type PrasadProposal } from '@cmt/shared-domain';
import { loadEngineInput } from './load-engine-input';

export interface PrasadPreviewResult extends PrasadProposal {
  defaultCap: number;
  eligibleSundayCount: number;
}

export async function previewAssignments(pid: string, location: string, cap?: number): Promise<PrasadPreviewResult> {
  const { input, defaultCap, eligibleSundayCount } = await loadEngineInput(pid, location, cap);
  return { ...proposePrasadAssignments(input), defaultCap, eligibleSundayCount };
}

/** Publish = preview + write each NEW row + the config doc. Idempotent: doc id
 *  is `${pid}-${fid}`; existing assignments are never touched (engine keeps them). */
export async function publishAssignments(pid: string, location: string, cap: number, actorMid: string): Promise<PrasadPreviewResult> {
  const proposal = await previewAssignments(pid, location, cap);
  const db = portalFirestore();
  const batchLimit = 400;
  for (let i = 0; i < proposal.rows.length; i += batchLimit) {
    const batch = db.batch();
    for (const row of proposal.rows.slice(i, i + batchLimit)) {
      const paid = `${pid}-${row.fid}`;
      batch.set(db.collection('prasadAssignments').doc(paid), {
        paid, pid, fid: row.fid,
        familyName: row.familyName, location: row.location,
        date: row.date,
        youngestMid: row.youngestMid, youngestName: row.youngestName,
        birthMonth: row.birthMonth, reason: row.reason,
        source: 'auto', status: 'assigned',
        assignedAt: FieldValue.serverTimestamp(),
        movedFrom: null, movedAt: null, movedBy: null,
        remindedAt: { weekBefore: null, twoDayBefore: null },
      }, { merge: true });
    }
    await batch.commit();
  }
  await db.collection('prasadConfig').doc(pid).set({
    pid, capPerSunday: cap, publishedAt: FieldValue.serverTimestamp(), publishedBy: actorMid,
  }, { merge: true });
  return proposal;
}
```

- [ ] **Step 6: Tests** — `__tests__/publish-assignments.test.ts` with the repo's chainable Firestore mock convention (copy the mock scaffold style from `apps/portal/src/features/setu/roster/__tests__/list-families.test.ts`): seed calendar entries (one `prasadNeeded:false` — assert it's excluded; one past-dated — excluded), two enrolled families, run `previewAssignments` → rows for both; run `publishAssignments` → assert `set` called with `paid` ids + config doc write. Cap default math: 2 families / 2 Sundays → 1.

- [ ] **Step 7: Run portal + shared-domain tests, commit:**

```bash
git add packages/shared-domain/src/setu/schemas/class-calendar.ts apps/portal/src/features/admin/calendar/calendar-editor.tsx apps/portal/src/features/setu/prasad/ packages/shared-domain/src/setu/__tests__/class-calendar-schemas.test.ts
git commit -m "feat(prasad): calendar prasadNeeded flag + engine-input loader + preview/publish"
```

---

### Task 6: Admin API routes + Firestore indexes

**Files:**
- Create: `apps/portal/src/app/api/admin/prasad/route.ts` (GET list), `preview/route.ts`, `publish/route.ts`, `assignment/route.ts` (PATCH)
- Modify: `firestore.indexes.json` (+2 indexes)
- Test: `apps/portal/src/app/api/admin/prasad/__tests__/routes.test.ts`

All four routes copy the exact gate stack of `apps/portal/src/app/api/admin/school-year/set-grade/route.ts` (flags.setuAuth 404 → session 401 → `isAdmin` 403 → zod 400 → work). `/api/admin/*` middleware catch-all already restricts to admin; the in-handler re-check stays (defense in depth).

- [ ] **Step 1: Indexes.** Add to `firestore.indexes.json`:

```json
{ "collectionGroup": "prasadAssignments", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "pid", "order": "ASCENDING" }, { "fieldPath": "date", "order": "ASCENDING" } ] },
{ "collectionGroup": "prasadAssignments", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "date", "order": "ASCENDING" } ] }
```

Deploy: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` (NEVER prod here).

- [ ] **Step 2: Preview route** — `preview/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isAdmin, PrasadPreviewBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { CURRENT_PRASAD_PIDS } from '@/features/setu/prasad/constants';
import { previewAssignments } from '@/features/setu/prasad/publish-assignments';

export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = PrasadPreviewBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  const period = CURRENT_PRASAD_PIDS.find((p) => p.pid === parsed.data.pid);
  if (!period) return NextResponse.json({ error: 'unknown-pid' }, { status: 400 });
  const result = await previewAssignments(period.pid, period.location, parsed.data.cap);
  return NextResponse.json(result, { status: 200 });
}
```

- [ ] **Step 3: Publish route** — same stack, `PrasadPublishBodySchema`, calls `publishAssignments(period.pid, period.location, parsed.data.cap, session.mid ?? session.uid ?? 'admin')`.

- [ ] **Step 4: List route** — `route.ts` GET with `?pid=...&date=...` (date optional): query `prasadAssignments` `where('pid','==',pid)` + optional `where('date','==',date)`, order in memory by date then familyName, serialize timestamps to ISO strings (`.toDate().toISOString()`); return `{ assignments: [...] }`.

- [ ] **Step 5: Assignment PATCH** — `assignment/route.ts` with `PrasadAdminReassignBodySchema`: load `doc(paid)`; 404 if missing; if `cancel` → `update({ status: 'cancelled' })`; else if `date` → `update({ date, movedFrom: <old date>, movedAt: FieldValue.serverTimestamp(), movedBy: <actor>, source: 'admin' })` (admin bypasses cap + lock — front-desk judgment); return `{ ok: true }`.

- [ ] **Step 6: Route tests** — one file covering: 401 no session, 403 non-admin, 400 bad body, preview 200 shape, publish writes (mock `publishAssignments`), PATCH cancel + reassign + 404. Mock `@/features/setu/prasad/publish-assignments` and Firestore per the conventions in `apps/portal/src/app/api/admin/school-year/__tests__` (if that dir exists, mirror it; otherwise mirror `apps/portal/src/app/api/welcome/reports/__tests__`).

- [ ] **Step 7: Test green → commit:**

```bash
git add apps/portal/src/app/api/admin/prasad firestore.indexes.json
git commit -m "feat(prasad): admin preview/publish/list/reassign APIs + prasadAssignments indexes (UAT-deployed)"
```

---

### Task 7: Family assignment server feature (read, options, move transaction)

**Files:**
- Create: `apps/portal/src/features/setu/prasad/family-assignment.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/family-assignment.test.ts`

- [ ] **Step 1: Implement**

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { CURRENT_PRASAD_PIDS, MOVE_LOCK_DAYS, daysUntil, torontoToday } from './constants';

export interface FamilyPrasadView {
  paid: string; pid: string; date: string;
  youngestName: string | null; birthMonth: number | null;
  reason: string; status: string; movable: boolean;
}

/** The family's current-period assignment, or null. Looks across both location pids. */
export async function getFamilyAssignment(fid: string): Promise<FamilyPrasadView | null> {
  const db = portalFirestore();
  for (const { pid } of CURRENT_PRASAD_PIDS) {
    const snap = await db.collection('prasadAssignments').doc(`${pid}-${fid}`).get();
    if (!snap.exists) continue;
    const a = snap.data() as { pid: string; date: string; youngestName: string | null; birthMonth: number | null; reason: string; status: string };
    if (a.status !== 'assigned') continue;
    return {
      paid: snap.id, pid: a.pid, date: a.date,
      youngestName: a.youngestName, birthMonth: a.birthMonth,
      reason: a.reason, status: a.status,
      movable: daysUntil(a.date, torontoToday()) > MOVE_LOCK_DAYS,
    };
  }
  return null;
}

export interface MoveOption { date: string; seatsLeft: number }

/** Future class Sundays (beyond the lock window) with seats under the published cap. */
export async function getMoveOptions(fid: string): Promise<{ paid: string; options: MoveOption[] } | null> {
  const current = await getFamilyAssignment(fid);
  if (!current) return null;
  const db = portalFirestore();
  const period = CURRENT_PRASAD_PIDS.find((p) => p.pid === current.pid)!;
  const todayYmd = torontoToday();

  const [calSnap, cfgSnap, assignedSnap] = await Promise.all([
    db.collection('classCalendarEntries').where('location', '==', period.location).where('programKey', '==', 'bala-vihar').get(),
    db.collection('prasadConfig').doc(current.pid).get(),
    db.collection('prasadAssignments').where('pid', '==', current.pid).get(),
  ]);
  const cap = (cfgSnap.data()?.capPerSunday as number | undefined) ?? 10;
  const countByDate = new Map<string, number>();
  for (const d of assignedSnap.docs) {
    const a = d.data() as { date: string; status: string };
    if (a.status === 'assigned') countByDate.set(a.date, (countByDate.get(a.date) ?? 0) + 1);
  }
  const options = calSnap.docs
    .map((d) => d.data() as { date: string; kind: string; enabled?: boolean; prasadNeeded?: boolean })
    .filter((e) => e.kind === 'class' && e.enabled !== false && e.prasadNeeded !== false)
    .filter((e) => daysUntil(e.date, todayYmd) > MOVE_LOCK_DAYS && e.date !== current.date)
    .map((e) => ({ date: e.date, seatsLeft: cap - (countByDate.get(e.date) ?? 0) }))
    .filter((o) => o.seatsLeft > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { paid: current.paid, options };
}

export type MoveResult = 'moved' | 'not-found' | 'locked' | 'target-full' | 'invalid-target';

/** Transactional self-serve move: re-validates lock + target capacity inside the txn. */
export async function moveAssignment(fid: string, targetDate: string, actorMid: string): Promise<MoveResult> {
  const opts = await getMoveOptions(fid);
  if (!opts) return 'not-found';
  const current = await getFamilyAssignment(fid);
  if (!current) return 'not-found';
  if (!current.movable) return 'locked';
  if (!opts.options.some((o) => o.date === targetDate)) return 'invalid-target';

  const db = portalFirestore();
  const cfgSnap = await db.collection('prasadConfig').doc(current.pid).get();
  const cap = (cfgSnap.data()?.capPerSunday as number | undefined) ?? 10;

  return db.runTransaction(async (tx) => {
    const targetQ = db.collection('prasadAssignments')
      .where('pid', '==', current.pid).where('date', '==', targetDate);
    const targetSnap = await tx.get(targetQ);
    const activeCount = targetSnap.docs.filter((d) => (d.data() as { status: string }).status === 'assigned').length;
    if (activeCount >= cap) return 'target-full' as const;
    tx.update(db.collection('prasadAssignments').doc(current.paid), {
      date: targetDate,
      movedFrom: current.date,
      movedAt: FieldValue.serverTimestamp(),
      movedBy: actorMid,
      source: 'family-move',
    });
    return 'moved' as const;
  });
}
```

- [ ] **Step 2: Tests** (chainable mock; mirror `list-families.test.ts` scaffolding): assignment found/not-found/cancelled-skipped; `movable:false` inside lock window (freeze "today" by mocking `constants.torontoToday`? No — pass through real dates far in the future in fixtures instead: fixture date = today+30d → movable; today+3d → locked); options exclude current date, locked dates, `prasadNeeded:false`, full dates; move happy path calls `tx.update` with `source:'family-move'`; move into full target → `'target-full'`.

- [ ] **Step 3: Green → commit:**

```bash
git add apps/portal/src/features/setu/prasad/family-assignment.ts apps/portal/src/features/setu/prasad/__tests__/family-assignment.test.ts
git commit -m "feat(prasad): family assignment read + move options + transactional move"
```

---

### Task 8: Family API routes + canAccessRoute rules

**Files:**
- Create: `apps/portal/src/app/api/setu/prasad/route.ts` (GET), `options/route.ts` (GET), `move/route.ts` (POST)
- Modify: `packages/shared-domain/src/auth/can-access-route.ts` (insert BEFORE the `/api/setu/` catch-all at line ~199)
- Tests: `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts` (extend existing file), `apps/portal/src/app/api/setu/prasad/__tests__/routes.test.ts`

- [ ] **Step 1: canAccessRoute rules** — insert above the `// Setu API — remaining paths` catch-all:

```ts
  // Setu API — prasad: any family role may view their assignment/options;
  // the move POST is manager-only. Must precede the manager-only catch-all.
  if (pathname === '/api/setu/prasad' || pathname.startsWith('/api/setu/prasad/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST') return isSetuManager(claims);
    return true;
  }
```

Extend the canAccessRoute test file: family-member GET `/api/setu/prasad` → true; family-member POST `/api/setu/prasad/move` → false; manager POST → true; teacher-only → false.

- [ ] **Step 2: Routes.** All three resolve `fid` from the session (mirror how `/api/setu/family` handlers bind `session.fid` — never trust a body fid). GET `route.ts`:

```ts
import { NextResponse } from 'next/server';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { getFamilyAssignment } from '@/features/setu/prasad/family-assignment';

export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session?.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const assignment = await getFamilyAssignment(session.fid);
  return NextResponse.json({ assignment }, { status: 200 });
}
```

`options/route.ts` GET → `getMoveOptions(session.fid)` → `{ paid, options }` or `{ paid: null, options: [] }` when null. `move/route.ts` POST → parse `PrasadMoveBodySchema` (400 on fail) → `moveAssignment(session.fid, body.date, session.mid ?? 'manager')` → map results: `moved` → 200 `{ ok: true }`; `not-found` → 404; `locked`/`target-full`/`invalid-target` → 409 `{ error: <result> }`.

- [ ] **Step 3: Route tests**: 401 unauthenticated; GET shape; move 400/404/409/200 mapping (mock `family-assignment`).

- [ ] **Step 4: Green → commit:**

```bash
git add apps/portal/src/app/api/setu/prasad packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/auth/__tests__/can-access-route.test.ts
git commit -m "feat(prasad): family GET/options/move APIs + role rules (view=family, move=manager)"
```

---

### Task 9: Client fetch wrappers

**Files:**
- Create: `apps/portal/src/features/setu/prasad/prasad-client.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/prasad-client.test.ts`

- [ ] **Step 1:** Mirror `set-grade-client.ts` / `roster-client.ts` conventions (throw on non-OK so UIs hit their error toasts):

```ts
import type { FamilyPrasadView, MoveOption } from './family-assignment';
import type { PrasadPreviewResult } from './publish-assignments';

export async function fetchMyPrasad(): Promise<FamilyPrasadView | null> {
  const res = await fetch('/api/setu/prasad');
  if (!res.ok) throw new Error(`prasad fetch failed: ${res.status}`);
  return ((await res.json()) as { assignment: FamilyPrasadView | null }).assignment;
}

export async function fetchMoveOptions(): Promise<MoveOption[]> {
  const res = await fetch('/api/setu/prasad/options');
  if (!res.ok) throw new Error(`options fetch failed: ${res.status}`);
  return ((await res.json()) as { options: MoveOption[] }).options;
}

export async function movePrasad(date: string): Promise<void> {
  const res = await fetch('/api/setu/prasad/move', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `move failed: ${res.status}`);
  }
}

export async function fetchPrasadPreview(pid: string, cap?: number): Promise<PrasadPreviewResult> {
  const res = await fetch('/api/admin/prasad/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cap != null ? { pid, cap } : { pid }),
  });
  if (!res.ok) throw new Error(`preview failed: ${res.status}`);
  return (await res.json()) as PrasadPreviewResult;
}

export async function publishPrasad(pid: string, cap: number): Promise<PrasadPreviewResult> {
  const res = await fetch('/api/admin/prasad/publish', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid, cap }),
  });
  if (!res.ok) throw new Error(`publish failed: ${res.status}`);
  return (await res.json()) as PrasadPreviewResult;
}
```

- [ ] **Step 2:** Tests: each wrapper happy-path + non-OK throws (`vi.stubGlobal('fetch', ...)` per the conventions in `roster-client` tests if present, else minimal). Green → commit `feat(prasad): client fetch wrappers`.

---

### Task 10: `/admin/prasad` screen + nav wiring

**Files:**
- Create: `apps/portal/src/app/admin/prasad/page.tsx`, `error.tsx`
- Create: `apps/portal/src/features/setu/prasad/admin-prasad-screen.tsx`
- Modify: `apps/portal/src/app/admin/page.tsx` (Bala Vihar group card), `apps/portal/src/features/admin/components/admin-sidebar.tsx` + `admin-mobile-nav.tsx` (mirror the "School year" / "Level management" entries exactly — find them with `grep -n "school-year" <file>`)
- Test: `apps/portal/src/features/setu/prasad/__tests__/admin-prasad-screen.test.tsx`

- [ ] **Step 1: Page** (server component, same scaffold as `/admin/school-year/page.tsx` — copy its flag/session handling). It renders `<AdminPrasadScreen />`. `error.tsx` copies the segment-error convention of `apps/portal/src/app/admin/school-year/error.tsx`.

- [ ] **Step 2: Screen** (`'use client'`, module-scope subcomponents only). State machine per location tab (Brampton default): on mount → `fetchPrasadPreview(pid)` → render: stats strip (`families / keptExisting / birthdayMonth / spill / noBirthMonth / unplaced`), cap input (`defaultValue={defaultCap}`, re-preview on change), proposed list grouped by Sunday (date heading + per-family rows with reason chip; chips: birthday-month → `var(--accentSoft)`, spill → `var(--setu-warn-soft)`, no-birth-month → `var(--surface2)`), `perSunday` bar list. Empty-calendar state: `eligibleSundayCount === 0` → "Publish the {location} class calendar first — the prasad rotation needs class Sundays." with a link to `/admin/calendar`. Publish button → `publishPrasad(pid, cap)` → success toast → re-preview (now mostly `keptExisting`). Unplaced > 0 → publish disabled with warn text "Raise the cap — {n} families don't fit." Already-published management: below the preview, a "Published assignments" section driven by `GET /api/admin/prasad?pid=...` listing per-Sunday groups with per-row actions (Reassign → date `<select>` of eligible Sundays + Save → PATCH; Cancel → PATCH `{cancel:true}` with `confirm()`). Keep every interactive control ≥44px; testids: `prasad-preview`, `prasad-publish`, `prasad-cap-input`, `prasad-sunday-group`.

- [ ] **Step 3: Nav wiring.** Admin dashboard: add a card "Prasad rotation — assign and manage prasad Sundays" linking `/admin/prasad` inside the Bala Vihar group (copy the School-year card JSX shape). Sidebar + mobile nav: add entry with the same icon component family the School-year entry uses.

- [ ] **Step 4: Component test** (rtl, mock `prasad-client`): renders stats from a mocked preview; publish disabled when `unplaced > 0`; empty-calendar message when `eligibleSundayCount === 0`. Use `getAllBy*` dual-branch convention if the screen renders mobile+desktop branches.

- [ ] **Step 5: Green → commit** `feat(prasad): /admin/prasad preview→publish screen + manage view + nav`.

---

### Task 11: Family dashboard card + `/family/prasad` page with move dialog

**Files:**
- Create: `apps/portal/src/features/setu/prasad/family-prasad-card.tsx`
- Create: `apps/portal/src/app/family/prasad/page.tsx`, `error.tsx`
- Modify: `apps/portal/src/app/family/page.tsx` (render the card; server-fetch via `getFamilyAssignment` next to the existing `getEnrollments`/`getDonations` calls — see imports at lines 13-20)
- Test: `apps/portal/src/features/setu/prasad/__tests__/family-prasad-card.test.tsx`

- [ ] **Step 1: Server read on the dashboard.** In `apps/portal/src/app/family/page.tsx`, fetch `const prasad = await getFamilyAssignment(fid)` alongside the other awaited reads (inside the existing Suspense'd server component — the page already does `await connection()`); render `<FamilyPrasadCard assignment={prasad} />` in BOTH the mobile and desktop layout branches, after the attendance/seva cards.

- [ ] **Step 2: Card + move dialog** (`'use client'`, receives the server-fetched assignment as prop). Renders null when `assignment == null` (families in locations without a published rotation see nothing). Display: "Your prasad Sunday" + `formatYmdToronto(date)` (e.g. "Sun, Mar 22") + subline `Why this date: {youngestName}'s birthday month` (reason `birthday-month`) / "Assigned by the team" otherwise + blurb "Bring prasad for the assembly — enough to share. Thank you for serving!". Move flow: "Can't make it? Move my date" button (hidden when `!assignment.movable`, replaced by "Date locked — within a week of your Sunday") → fixed-position sheet (wrap in `CspRoot`/`className="csp"` — token scoping) listing `fetchMoveOptions()` dates as ≥44px radio rows with `{seatsLeft} spots left` badge → Confirm → `movePrasad(date)` → success toast + `router.refresh()`; 409 errors toast specific copy: `target-full` → "That Sunday just filled up — pick another", `locked` → "Too close to your date to move it online — contact the welcome team."

- [ ] **Step 3: `/family/prasad` page**: server component fetching the same view + the card expanded full-page (mobile + desktop branches), so the dashboard card can `Link` to it ("View details →"). Copy the page scaffold (flags/session/connection/Suspense) from `apps/portal/src/app/family/donations/page.tsx`.

- [ ] **Step 4: Component test**: renders date + reason; hides move button when `movable:false`; move flow calls `movePrasad` with the picked date (mock `prasad-client`); `target-full` rejection shows the retry toast copy (mock toast per existing toast-test conventions in the repo).

- [ ] **Step 5: Green → commit** `feat(prasad): family dashboard card + /family/prasad self-serve move`.

---

### Task 12: Reminders — service + daily cron + vercel.ts

**Files:**
- Create: `apps/portal/src/features/setu/prasad/reminder-service.ts`
- Create: `apps/portal/src/app/api/cron/send-prasad-reminders/route.ts`
- Modify: `vercel.ts` (crons array, line ~4)
- Tests: `apps/portal/src/features/setu/prasad/__tests__/reminder-service.test.ts`, `apps/portal/src/app/api/cron/__tests__/send-prasad-reminders.test.ts` (mirror the existing cron test in that dir)

- [ ] **Step 1: Service**

```ts
// reminder-service.ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { torontoToday, daysUntil } from './constants';

type Kind = 'weekBefore' | 'twoDayBefore';
const KIND_BY_DAYS: Record<number, Kind> = { 7: 'weekBefore', 2: 'twoDayBefore' };

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export interface ReminderRunResult { checked: number; sent: number; skipped: number }

/** Send 7-day / 2-day prasad reminders to family managers. Idempotent via remindedAt stamps. */
export async function sendDuePrasadReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const db = portalFirestore();
  const today = torontoToday(now);
  const sender = resolveSender();

  // status==assigned + date in the two target days → backed by (status,date) index.
  const targets: string[] = Object.keys(KIND_BY_DAYS).map((d) => addDays(today, Number(d)));
  const snap = await db.collection('prasadAssignments')
    .where('status', '==', 'assigned').where('date', 'in', targets).get();

  let sent = 0, skipped = 0;
  for (const doc of snap.docs) {
    const a = doc.data() as {
      fid: string; date: string; familyName: string;
      remindedAt?: { weekBefore?: unknown; twoDayBefore?: unknown };
    };
    const kind = KIND_BY_DAYS[daysUntil(a.date, today)];
    if (!kind) continue;
    if (a.remindedAt?.[kind] != null) { skipped++; continue; }

    const managersSnap = await db.collection('families').doc(a.fid)
      .collection('members').where('manager', '==', true).get();
    const when = formatDate(a.date);
    const lead = kind === 'weekBefore' ? 'is one week away' : 'is this Sunday';
    for (const m of managersSnap.docs) {
      const mem = m.data() as { email?: string | null; phone?: string | null; firstName?: string };
      const msg = `Namaste ${mem.firstName ?? ''}! Your family's Bala Vihar prasad day ${lead} — ${when}. Please bring prasad for the assembly. — Chinmaya Mission Toronto`;
      if (mem.email) await sender.sendEmail({ to: mem.email, subject: `Prasad reminder — ${when}`, text: msg });
      if (mem.phone) await sender.sendSMS({ phone: mem.phone, message: msg });
    }
    await doc.ref.set({ remindedAt: { [kind]: FieldValue.serverTimestamp() } }, { merge: true });
    sent++;
  }
  return { checked: snap.size, sent, skipped };
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Cron route** — copy `send-weekly-payment-reminders/route.ts`'s `verifyCronAuth` (timing-safe `CRON_SECRET` bearer) verbatim; kill switch `PRASAD_REMINDER_CRON_ENABLED !== 'true'` → `{ success: true, disabled: true }`; else `const result = await sendDuePrasadReminders()` → `{ success: true, ...result }`.

- [ ] **Step 3: vercel.ts** — add `{ path: '/api/cron/send-prasad-reminders', schedule: '0 14 * * *' }` (daily 14:00 UTC ≈ 9/10am Toronto) to the crons array.

- [ ] **Step 4: Tests.** Service: fixture assignments at today+7 / today+2 / today+7-already-stamped → exactly 2 sends, stamped doc skipped, `set` called with the right `remindedAt` key, email AND SMS attempted for a manager carrying both (mock `resolveSender` + Firestore). Cron route: 401 without bearer; disabled without the env flag; calls service with flag on (mirror the existing cron route test file's mocking).

- [ ] **Step 5: Green → commit** `feat(prasad): 7d/2d email+SMS reminders via daily cron (idempotent stamps)`.

**Vercel env note (manual, after deploy):** set `CRON_SECRET` already exists; add `PRASAD_REMINDER_CRON_ENABLED=true` to UAT via `vercel env add PRASAD_REMINDER_CRON_ENABLED production --value "true" --no-sensitive --force --yes` when ready to go live — leave unset until then (cron returns disabled).

---

### Task 13: Welcome-team read-only view

**Files:**
- Create: `apps/portal/src/app/api/welcome/prasad/upcoming/route.ts`
- Create: `apps/portal/src/app/welcome/prasad/page.tsx`, `error.tsx`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts` (welcome rule, next to the `/api/welcome/families` rule at line ~158) + its test
- Modify: welcome nav (`apps/portal/src/features/family/components/desktop-sidebar.tsx` welcome-team tabs + `welcome-mobile-nav`): add "Prasad" entry mirroring the "Roster" entry
- Test: route test alongside the other welcome route tests

- [ ] **Step 1: canAccessRoute** — add with the other welcome rules:

```ts
  // Welcome-team API — prasad day-of lists (read-only).
  if (pathname === '/api/welcome/prasad' || pathname.startsWith('/api/welcome/prasad/')) {
    return isWelcomeTeam(claims);
  }
```

+ test cases (welcome-team true, family-manager false).

- [ ] **Step 2: Upcoming route** — GET: for each `CURRENT_PRASAD_PIDS`, query `prasadAssignments` `where('pid','==',pid).where('date','>=',torontoToday())` ordered by date (backed by the `(pid,date)` index), `limit(60)`; join manager contact info per family (members where `manager==true` → name + phone + email); group by date; return `{ locations: [{ location, sundays: [{ date, families: [{ fid, familyName, contacts }] }] }] }` with ISO-string dates.

- [ ] **Step 3: Page** — server component (welcome layout already re-verifies the role; copy the defensive re-check from `/welcome/family/[fid]/page.tsx`): renders the next 4 Sundays per location as cards — family name + manager contact line, count badge per Sunday ("8 families"), location tabs. Mobile + desktop branches.

- [ ] **Step 4: Nav** — "Prasad" entry in the welcome sidebar/mobile nav linking `/welcome/prasad`.

- [ ] **Step 5: Tests green → commit** `feat(prasad): welcome-team upcoming prasad view`.

---

### Task 14: E2E spec + seed fixture + docs

**Files:**
- Modify: `apps/portal/scripts/seed-e2e-family.ts` (prasad fixture upsert)
- Create: `apps/portal/e2e/setu/admin/prasad.spec.ts`
- Modify: `docs/runbooks/production-cutover-checklist.md` (§10 alias row + §14 entry), `CLAUDE.md` (module status line)

- [ ] **Step 1: Seed fixture.** Extend `seed-e2e-family.ts` with an idempotent upsert of: `prasadConfig/bv-brampton-2025-26` `{ pid, capPerSunday: 10, publishedAt: now, publishedBy: 'seed-script' }` and `prasadAssignments/bv-brampton-2025-26-CMT-FSWEDU2X` `{ ...full doc shape from Task 1, fid: 'CMT-FSWEDU2X', familyName: 'E2E Test Family', location: 'Brampton', date: '2026-06-14', youngestMid: 'CMT-FSWEDU2X-02', youngestName: 'E2E Child', birthMonth: 6, reason: 'birthday-month', source: 'auto', status: 'assigned', assignedAt: now, movedFrom: null, movedAt: null, movedBy: null, remindedAt: { weekBefore: null, twoDayBefore: null } }`. Run `pnpm --filter @cmt/portal seed:e2e-family` against UAT.

- [ ] **Step 2: E2E spec** (conventions: `import { test, expect } from '@playwright/test'` + `hasFamilyCreds` from `../../_helpers`; storageState provides the admin+manager session; run against deployed UAT after `git push` deploys):

```ts
import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

const PID = 'bv-brampton-2025-26';

test.describe('Prasad module', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('admin preview endpoint returns the proposal shape (read-only)', async ({ page }) => {
    const res = await page.request.post('/api/admin/prasad/preview', { data: { pid: PID } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.cap).toBe('number');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.perSunday)).toBe(true);
    expect(typeof body.stats.families).toBe('number');
  });

  test('admin preview rejects an unknown pid', async ({ page }) => {
    const res = await page.request.post('/api/admin/prasad/preview', { data: { pid: 'nope' } });
    expect(res.status()).toBe(400);
  });

  test('family GET returns the seeded assignment', async ({ page }) => {
    const res = await page.request.get('/api/setu/prasad');
    expect(res.status()).toBe(200);
    const { assignment } = await res.json();
    expect(assignment?.paid).toBe(`${PID}-CMT-FSWEDU2X`);
    expect(assignment?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('family dashboard renders the prasad card', async ({ page }) => {
    await page.goto('/family');
    await expect(page.getByText(/your prasad sunday/i).filter({ visible: true }).first())
      .toBeVisible({ timeout: 20_000 });
  });

  test('move validates: bad body 400, then round-trip when options exist', async ({ page }) => {
    const bad = await page.request.post('/api/setu/prasad/move', { data: { date: 'nope' } });
    expect(bad.status()).toBe(400);

    const optsRes = await page.request.get('/api/setu/prasad/options');
    expect(optsRes.status()).toBe(200);
    const { options } = await optsRes.json();
    if (options.length === 0) {
      test.info().annotations.push({ type: 'note', description: 'No open future Sundays in UAT — move round-trip skipped.' });
      return;
    }
    const original = (await (await page.request.get('/api/setu/prasad')).json()).assignment.date;
    const target = options[0].date;
    const move = await page.request.post('/api/setu/prasad/move', { data: { date: target } });
    expect(move.status()).toBe(200);
    // revert (seed value) — keeps the fixture stable for the next run
    const revert = await page.request.post('/api/setu/prasad/move', { data: { date: original } });
    // revert can 409 if original is now locked/full; re-seed restores it regardless
    expect([200, 409]).toContain(revert.status());
  });

  test('welcome upcoming endpoint is welcome-team readable', async ({ page }) => {
    const res = await page.request.get('/api/welcome/prasad/upcoming');
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).locations)).toBe(true);
  });
});
```

- [ ] **Step 3: Push, wait for the Vercel deploy, run** `pnpm test:e2e -- e2e/setu/admin/prasad.spec.ts` against `https://cmt-setu.vercel.app` — all green (or annotated skips).

- [ ] **Step 4: Docs.** Runbook §10: add `backfill:birth-months` row (snapshot-fed, idempotent, `--allow-prod` at cutover). Runbook §14 entry (same turn as the UAT index deploy + backfill run): indexes deployed (×2), backfill run counts, new collections `prasadAssignments`/`prasadConfig`, new env `PRASAD_REMINDER_CRON_ENABLED`, new cron path, prod TODO (deploy indexes no `--force`, run backfill `--allow-prod`, seed Scarborough calendar, publish from `/admin/prasad`, set the cron env). CLAUDE.md: add a "Prasad module" status line near the admin-revamp block.

- [ ] **Step 5: Final commit + push** `feat(prasad): E2E coverage vs deployed UAT + runbook/docs`.

---

## Self-review notes (spec coverage)

- Spec §Data model → Tasks 1, 3, 5, 6 (schemas, birthMonth, prasadNeeded, config, indexes). ✓
- Spec §Engine → Task 2 (all rules incl. tie-breaks, determinism, kept-existing, unplaceable). ✓
- Spec §Admin → Tasks 6, 10 (preview/publish/manage/this-Sunday admin; welcome view Task 13). ✓
- Spec §Family → Tasks 7, 8, 9, 11 (read/options/move + lock + cap transaction + UI). ✓
- Spec §Reminders → Task 12 (7d/2d, email+SMS, idempotent stamps, allowlists inherited via resolveSender). ✓
- Spec §Backfill/rollout → Task 4 (backfill), deviation note (forms), Task 14 (docs/prod TODO). Scarborough calendar = operational (deviation note 2). ✓
- Spec §Testing → unit TDD throughout; route tests Tasks 6/8/12/13; E2E Task 14. ✓
