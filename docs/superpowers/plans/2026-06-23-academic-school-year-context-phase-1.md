# Academic School-Year Context — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live school year visible everywhere (admin/family/teacher) and turn `/admin/school-year` into a "Year center" that prepares next year (copy levels/offerings + calendar from last year), promotes kids, and Activates — flipping the live year and aligning seva's year, blocked unless promotion has run.

**Architecture:** No schema change — data is already year-tagged (`offerings.termLabel`, `levels.pid/periodLabel`, `enrollments.oid/termLabel`, `seva_opportunities.sevaYear`, `classCalendarEntries` by date). We add: (a) a cached live-year read + a small badge rendered in each shell; (b) a calendar-clone helper modeled on `start-new-year.ts`; (c) a readiness computation; (d) an admin-only Activate route that sets `app_config/school_year.currentYear` AND `app_config/seva_requirement.currentSevaYear` together, gated on a "promotion ran" data signal; (e) Year-center UI wiring. The interactive per-surface year *switcher* is deferred to Phase 2 — Phase 1's badge is read-only (live year) and the Year center operates on live-year → next-year like today's rollover.

**Tech Stack:** Next.js 16 App Router (cacheComponents), React, TypeScript (exactOptionalPropertyTypes + noUncheckedIndexedAccess), Firestore (Admin SDK), Vitest + fake-firestore, Playwright (deployed-UAT). Shared types in `@cmt/shared-domain`.

---

## File structure

**Create**
- `apps/portal/src/features/setu/rollover/live-school-year.ts` — `getLiveSchoolYearCached()` (cached single-doc read, tag `school-year`).
- `apps/portal/src/components/chrome/school-year-badge.tsx` — `<SchoolYearBadge>` server component (live year pill; optional "Preparing {next}" note for admin).
- `apps/portal/src/features/setu/rollover/clone-calendar.ts` — `cloneCalendarYear()` (clone a school year's BV calendar entries +52 weeks).
- `apps/portal/src/features/setu/rollover/year-readiness.ts` — `computeYearReadiness()` (per-item ✓/✗ + `promotionRan`).
- `apps/portal/src/app/api/admin/school-year/activate/route.ts` — POST Activate (admin-only).
- `apps/portal/src/app/api/admin/school-year/copy-calendar/route.ts` — POST copy calendar (admin-only).
- `apps/portal/e2e/setu/admin/year-center.spec.ts` — deployed-UAT E2E.
- `apps/portal/scripts/seed-year-center-fixture.ts` — UAT-only multi-year fixture seed for the E2E.

**Modify**
- `apps/portal/src/features/setu/rollover/school-year.ts` — add `schoolYearDateRange(year)`.
- `apps/portal/src/app/api/admin/school-year/route.ts` — GET also returns `readiness`; Activate/copy revalidate `school-year` tag.
- `apps/portal/src/features/setu/rollover/rollover-client.ts` — add `activateSchoolYearClient()`, `copyCalendarFromLastYearClient()`.
- `apps/portal/src/features/setu/rollover/components/rollover-page.tsx` (+ a new `year-readiness-checklist.tsx` and an Activate control) — render readiness + Activate.
- `apps/portal/src/features/admin/components/admin-sidebar.tsx` — render `<SchoolYearBadge admin />` in the admin chrome header.
- `apps/portal/src/features/family/components/desktop-sidebar.tsx` (+ mobile nav) — render `<SchoolYearBadge>`.
- `apps/portal/src/features/setu/teacher/components/teacher-top-bar.tsx` — render `<SchoolYearBadge>`.
- `apps/portal/package.json` — add `seed:year-center-fixture` alias.
- `apps/portal/e2e/_helpers.ts` — Year-center creds.
- `docs/runbooks/production-cutover-checklist.md` — §14 entry.

**Shared-domain (Modify)**
- `packages/shared-domain/src/setu/...` — add `YearReadinessSchema` + `CalendarCopyResultSchema` (+ exports). (Year-readiness/calendar-copy are returned by `/api/admin/*` only — NOT `/api/setu/*` — so NO MOBILE_API_CHANGELOG entry is required.)

---

## Task 1: `schoolYearDateRange` helper

**Files:**
- Modify: `apps/portal/src/features/setu/rollover/school-year.ts`
- Test: `apps/portal/src/features/setu/rollover/__tests__/school-year.test.ts` (add cases; create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { schoolYearDateRange } from '../school-year';

describe('schoolYearDateRange', () => {
  it('maps "2025-26" to an Aug→Jul date-string window', () => {
    expect(schoolYearDateRange('2025-26')).toEqual({ start: '2025-08-01', end: '2026-07-31' });
  });
  it('throws on a malformed year', () => {
    expect(() => schoolYearDateRange('2025')).toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`schoolYearDateRange` not exported)

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover/__tests__/school-year.test.ts`
Expected: FAIL — "schoolYearDateRange is not a function".

- [ ] **Step 3: Implement**

Append to `school-year.ts`:

```ts
/** A school year's calendar window as YYYY-MM-DD date strings: Aug 1 (start
 *  year) through Jul 31 (end year). Used to scope classCalendarEntries by year. */
export function schoolYearDateRange(year: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(year.trim());
  if (!m) throw new Error(`Invalid school year: ${year}`);
  const startYear = Number(m[1]);
  return { start: `${startYear}-08-01`, end: `${startYear + 1}-07-31` };
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/rollover/school-year.ts apps/portal/src/features/setu/rollover/__tests__/school-year.test.ts
git commit -m "feat(rollover): schoolYearDateRange helper"
```

---

## Task 2: Cached live-year read + `<SchoolYearBadge>`

**Files:**
- Create: `apps/portal/src/features/setu/rollover/live-school-year.ts`
- Create: `apps/portal/src/components/chrome/school-year-badge.tsx`
- Test: `apps/portal/src/components/chrome/__tests__/school-year-badge.test.tsx`

**Why cached:** the badge renders on every admin/family/teacher page; a `'use cache'` single-doc read keyed `school-year` is cheap and is busted by `revalidateTag('school-year')` on Activate.

- [ ] **Step 1: live-year cached read** — create `live-school-year.ts`:

```ts
import { cacheTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getSchoolYearConfig } from './school-year-config';

/** The live (operational) school year, cached. Busted by
 *  revalidateTag('school-year') when an admin Activates a new year. */
export async function getLiveSchoolYearCached(): Promise<string> {
  'use cache';
  cacheTag('school-year');
  const { currentYear } = await getSchoolYearConfig(portalFirestore());
  return currentYear;
}
```

- [ ] **Step 2: Write the failing badge test** — `school-year-badge.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/features/setu/rollover/live-school-year', () => ({
  getLiveSchoolYearCached: vi.fn().mockResolvedValue('2025-26'),
}));

import { SchoolYearBadge } from '../school-year-badge';

describe('SchoolYearBadge', () => {
  it('renders the live year', async () => {
    render(await SchoolYearBadge({}));
    expect(screen.getByText(/School year 2025-26/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (module not found).

Run: `pnpm --filter @cmt/portal exec vitest run src/components/chrome/__tests__/school-year-badge.test.tsx`

- [ ] **Step 4: Implement `school-year-badge.tsx`** (server component; `.csp`-scoped pill so tokens resolve — see [[feedback_csp_token_scoping]]):

```tsx
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';

/** Read-only live-year pill for the admin/family/teacher chrome. */
export async function SchoolYearBadge({ className }: { className?: string }) {
  const year = await getLiveSchoolYearCached();
  return (
    <span
      className={`csp ${className ?? ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
        color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
      }}
    >
      School year {year}
    </span>
  );
}
```

- [ ] **Step 5: Run it — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/rollover/live-school-year.ts apps/portal/src/components/chrome/school-year-badge.tsx apps/portal/src/components/chrome/__tests__/school-year-badge.test.tsx
git commit -m "feat(chrome): cached live-year read + SchoolYearBadge"
```

---

## Task 3: Mount the badge in the three shells

**Files (Modify):**
- `apps/portal/src/features/admin/components/admin-sidebar.tsx`
- `apps/portal/src/features/family/components/desktop-sidebar.tsx`
- `apps/portal/src/features/setu/teacher/components/teacher-top-bar.tsx`

> These are chrome components rendered inside each area's CspRoot layout. The badge is a server component; the family/admin sidebars are server-rendered (`*Live` variants) so they can `await` it. If a target file is a client component, render the badge from the server layout instead and pass it as a prop/child (do NOT call the server read from a client component — see [[feedback_client_server_boundary]]).

- [ ] **Step 1 (admin):** In `admin-sidebar.tsx`, import `SchoolYearBadge` and render `<SchoolYearBadge className="..." />` in the sidebar header block (near the "Admin" title). If `AdminSidebarLive` is the server wrapper, render it there; verify it's server-side by checking for `'use client'` at the top first.

- [ ] **Step 2 (family):** In `desktop-sidebar.tsx`, render the badge under the family name in `DesktopSidebarLive` (the server variant that already `await`s identity). Add a matching badge to the mobile nav header if the family mobile layout has one.

- [ ] **Step 3 (teacher):** In `teacher-top-bar.tsx`, render the badge next to the brand. If `TeacherTopBar` is a client component, lift the badge into `app/teacher/layout.tsx` (server) and pass it as a child.

- [ ] **Step 4: Manual check** — `pnpm --filter @cmt/portal build` succeeds; then verify in UAT after deploy (Task 8). No new unit test (pure placement); the E2E asserts the label.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/admin/components/admin-sidebar.tsx apps/portal/src/features/family/components/desktop-sidebar.tsx apps/portal/src/features/setu/teacher/components/teacher-top-bar.tsx
git commit -m "feat(chrome): show live school-year badge in admin/family/teacher shells"
```

---

## Task 4: Calendar-clone helper

**Files:**
- Create: `apps/portal/src/features/setu/rollover/clone-calendar.ts`
- Test: `apps/portal/src/features/setu/rollover/__tests__/clone-calendar.test.ts`

**Design:** clone every BV `classCalendarEntries` doc whose `date` falls in `schoolYearDateRange(fromYear)` to `toYear`, shifting the date by **+52 weeks (364 days)** so a class Sunday stays a Sunday (a naive +1 calendar year would land on a Saturday). Idempotent: skip an existing target doc. Mirrors `start-new-year.ts` (read source → compute target id → skip-or-create). The target doc id uses the same `calendarEntryId(location, date)` scheme the create route uses (confirm its signature in `@cmt/shared-domain` and the `/api/admin/calendar` POST route).

- [ ] **Step 1: Write the failing test** (fake-firestore; seed two source entries, assert two created +364 days, weekday preserved, idempotent re-run creates 0):

```ts
import { describe, it, expect } from 'vitest';
import { makeFakeFirestore } from '@/test/fake-firestore'; // use the repo's existing fake-firestore helper
import { cloneCalendarYear } from '../clone-calendar';

function plus364(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 364);
  return dt.toISOString().slice(0, 10);
}

describe('cloneCalendarYear', () => {
  it('clones BV entries +52 weeks, weekday preserved, idempotent', async () => {
    const db = makeFakeFirestore();
    for (const date of ['2025-09-07', '2025-12-21']) {
      await db.collection('classCalendarEntries').doc(`brampton-${date}`).set({
        date, location: 'Brampton', programKey: 'bala-vihar', kind: 'class', classType: 'regular',
        noClassReason: null, specialEvents: null,
      });
    }
    const r1 = await cloneCalendarYear(db as any, { fromYear: '2025-26', toYear: '2026-27', dryRun: false });
    expect(r1.created).toHaveLength(2);
    const target = await db.collection('classCalendarEntries').doc(`brampton-${plus364('2025-09-07')}`).get();
    expect(target.exists).toBe(true);
    expect(new Date(`${plus364('2025-09-07')}T00:00:00Z`).getUTCDay()).toBe(0); // Sunday

    const r2 = await cloneCalendarYear(db as any, { fromYear: '2025-26', toYear: '2026-27', dryRun: false });
    expect(r2.created).toHaveLength(0);
    expect(r2.existing).toHaveLength(2);
  });
});
```

> NOTE: locate the repo's existing fake-firestore test helper (grep `makeFakeFirestore`/`fake-firestore` under `apps/portal/src`) and use that exact import; the snippet's path is illustrative.

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement `clone-calendar.ts`:**

```ts
import { calendarEntryId } from '@cmt/shared-domain';
import type { CalendarCopyResult } from '@cmt/shared-domain';
import { schoolYearDateRange } from './school-year';

type Db = FirebaseFirestore.Firestore;
const BV = 'bala-vihar';

function shift364(dateStr: string): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 364); // 52 weeks → same weekday
  return dt.toISOString().slice(0, 10);
}

export async function cloneCalendarYear(
  db: Db,
  args: { fromYear: string; toYear: string; dryRun: boolean },
): Promise<CalendarCopyResult> {
  const { start, end } = schoolYearDateRange(args.fromYear);
  const snap = await db
    .collection('classCalendarEntries')
    .where('programKey', '==', BV)
    .where('date', '>=', start)
    .where('date', '<=', end)
    .get();

  const created: string[] = [];
  const existing: string[] = [];
  for (const doc of snap.docs) {
    const src = doc.data() as Record<string, unknown>;
    const location = String(src['location']);
    const newDate = shift364(String(src['date']));
    const targetId = calendarEntryId(location, newDate);
    const targetRef = db.collection('classCalendarEntries').doc(targetId);
    if ((await targetRef.get()).exists) { existing.push(targetId); continue; }
    created.push(targetId);
    if (!args.dryRun) {
      await targetRef.set({
        ...src,
        date: newDate,
        // carry over kind/classType/noClassReason/specialEvents/location/programKey;
        // drop server timestamps so they re-stamp:
        createdAt: undefined, updatedAt: undefined,
      });
    }
  }
  return { fromYear: args.fromYear, toYear: args.toYear, created, existing };
}
```

> Verify `calendarEntryId`'s real signature against the `/api/admin/calendar` POST route (`src/app/api/admin/calendar/route.ts`) and the seed; match it exactly. Adjust the spread to the real doc shape (don't write `undefined` fields under exactOptionalPropertyTypes — use a built object instead if needed).

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Firestore index audit** (REQUIRED — fake-firestore is index-blind, see `auditing-firestore-indexes`):

The new query is `classCalendarEntries` where `programKey == BV` and `date` range. Check `firestore.indexes.json` for a `classCalendarEntries (programKey, date)` (or `(location, programKey, date)`) composite. If absent, add it and deploy to UAT only:
```bash
firebase deploy --only firestore:indexes --project chinmaya-setu-uat   # NEVER --force, NEVER prod
```

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/rollover/clone-calendar.ts apps/portal/src/features/setu/rollover/__tests__/clone-calendar.test.ts firestore.indexes.json
git commit -m "feat(rollover): cloneCalendarYear (+52wk) helper + index"
```

---

## Task 5: `YearReadiness` schema + `computeYearReadiness`

**Files:**
- Modify: `packages/shared-domain/src/setu/` (add `YearReadinessSchema`, `CalendarCopyResultSchema`, export both)
- Create: `apps/portal/src/features/setu/rollover/year-readiness.ts`
- Test: `apps/portal/src/features/setu/rollover/__tests__/year-readiness.test.ts`

**Readiness signals for `toYear`:**
| Item | Signal |
|---|---|
| `offerings` | any `offerings` doc with `termLabel == toYear` and `programKey == bala-vihar` |
| `levels` | any `levels` doc with `pid` in `bv-{loc}-{toYear}` (use `balaViharSourceOidsForYear(toYear)`) |
| `calendar` | any `classCalendarEntries` with `programKey==BV` and `date` in `schoolYearDateRange(toYear)` |
| `teachers` | any `toYear` level with non-empty `teacherRefs` |
| `prasad` | a `prasadConfig` doc exists for the `toYear` period (Phase 2 copies it; readiness just checks) |
| `seva` | any `seva_opportunities` with `sevaYear == toYear` |
| `promotionRan` | any active enrollment on a `bv-{loc}-{toYear}` oid (the gate) |

- [ ] **Step 1: Schemas.** In shared-domain add:

```ts
import { z } from 'zod';
export const YearReadinessSchema = z.object({
  toYear: z.string(),
  promotionRan: z.boolean(),
  offerings: z.boolean(),
  levels: z.boolean(),
  calendar: z.boolean(),
  teachers: z.boolean(),
  prasad: z.boolean(),
  seva: z.boolean(),
});
export type YearReadiness = z.infer<typeof YearReadinessSchema>;

export const CalendarCopyResultSchema = z.object({
  fromYear: z.string(), toYear: z.string(),
  created: z.array(z.string()), existing: z.array(z.string()),
});
export type CalendarCopyResult = z.infer<typeof CalendarCopyResultSchema>;
```
Export them from the package index. Run `pnpm --filter @cmt/shared-domain build` (or the repo's build) if shared-domain is prebuilt.

- [ ] **Step 2: Write the failing test** (fake-firestore: seed toYear offerings + an active bv-*-toYear enrollment, assert `offerings:true`, `promotionRan:true`, others false):

```ts
import { describe, it, expect } from 'vitest';
import { makeFakeFirestore } from '@/test/fake-firestore';
import { computeYearReadiness } from '../year-readiness';

describe('computeYearReadiness', () => {
  it('reports per-item readiness + promotionRan', async () => {
    const db = makeFakeFirestore();
    await db.collection('offerings').doc('bv-brampton-2026-27').set({ oid: 'bv-brampton-2026-27', programKey: 'bala-vihar', termLabel: '2026-27' });
    await db.collection('families').doc('F1').collection('enrollments').doc('F1-bv-brampton-2026-27')
      .set({ oid: 'bv-brampton-2026-27', status: 'active', fid: 'F1' });
    const r = await computeYearReadiness(db as any, { fromYear: '2025-26', toYear: '2026-27' });
    expect(r).toMatchObject({ toYear: '2026-27', offerings: true, promotionRan: true, levels: false, calendar: false, teachers: false, seva: false });
  });
});
```

- [ ] **Step 3: Run it — expect FAIL.**

- [ ] **Step 4: Implement `year-readiness.ts`** (each check `.limit(1)`; uses `balaViharSourceOidsForYear` + `schoolYearDateRange`):

```ts
import { balaViharSourceOidsForYear, schoolYearDateRange } from './school-year';
import type { YearReadiness } from '@cmt/shared-domain';

type Db = FirebaseFirestore.Firestore;
const BV = 'bala-vihar';

async function any(q: FirebaseFirestore.Query): Promise<boolean> {
  return !(await q.limit(1).get()).empty;
}

export async function computeYearReadiness(
  db: Db,
  args: { fromYear: string; toYear: string },
): Promise<YearReadiness> {
  const oids = balaViharSourceOidsForYear(args.toYear); // ['bv-brampton-2026-27','bv-scarborough-2026-27']
  const { start, end } = schoolYearDateRange(args.toYear);

  const [offerings, levels, calendar, teachers, prasad, seva, promotionRan] = await Promise.all([
    any(db.collection('offerings').where('programKey', '==', BV).where('termLabel', '==', args.toYear)),
    any(db.collection('levels').where('pid', 'in', oids)),
    any(db.collection('classCalendarEntries').where('programKey', '==', BV).where('date', '>=', start).where('date', '<=', end)),
    any(db.collection('levels').where('pid', 'in', oids).where('teacherRefs', '!=', [])),
    any(db.collection('prasadConfig').where('periodLabel', '==', args.toYear)), // adjust to the real prasadConfig year field
    any(db.collection('seva_opportunities').where('sevaYear', '==', args.toYear)),
    any(db.collectionGroup('enrollments').where('oid', 'in', oids).where('status', '==', 'active')),
  ]);

  return { toYear: args.toYear, offerings, levels, calendar, teachers, prasad, seva, promotionRan };
}
```

> Verify the real `prasadConfig` year field name (open a prasadConfig doc / its writer). The `teacherRefs != []` query and the collectionGroup `oid in [...] + status` query each need a composite index — **run the index audit** (Step 5). If `!=` on an array is unsupported, fall back to reading the toYear levels and checking `teacherRefs.length > 0` in memory.

- [ ] **Step 5: Run it — expect PASS**, then **index audit** for: `levels (pid, teacherRefs)` if used; `seva_opportunities (sevaYear)`; the collectionGroup `enrollments (oid, status)` (already exists); `offerings (programKey, termLabel)`; `classCalendarEntries (programKey, date)`. Add any missing to `firestore.indexes.json` + deploy to UAT only.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain apps/portal/src/features/setu/rollover/year-readiness.ts apps/portal/src/features/setu/rollover/__tests__/year-readiness.test.ts firestore.indexes.json
git commit -m "feat(rollover): YearReadiness schema + computeYearReadiness"
```

---

## Task 6: Activate + copy-calendar routes; extend GET with readiness

**Files:**
- Create: `apps/portal/src/app/api/admin/school-year/activate/route.ts`
- Create: `apps/portal/src/app/api/admin/school-year/copy-calendar/route.ts`
- Modify: `apps/portal/src/app/api/admin/school-year/route.ts` (GET → include `readiness`)
- Test: `apps/portal/src/app/api/admin/school-year/__tests__/activate.test.ts` (+ extend `routes.test.ts`)

> Auth pattern (match existing routes): `readSessionFromHeaders(req)` + `isAdmin(session)` → 403. `/api/admin/*` is already covered by `canAccessRoute` — confirm no new rule needed (it's the admin catch-all). These are `/api/admin/*`, NOT `/api/setu/*`, so **no MOBILE_API_CHANGELOG entry**.

- [ ] **Step 1: Write the failing Activate test** — mocks `computeYearReadiness`, `setSchoolYearConfig`, `getSevaRequirement`/`setSevaRequirement`, and asserts: (a) 409 `promotion-not-run` when `promotionRan:false`; (b) on success, sets `currentYear=next` AND `currentSevaYear=next`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
const setYear = vi.fn(), getSeva = vi.fn(), setSeva = vi.fn(), readiness = vi.fn();
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: vi.fn().mockResolvedValue({ currentYear: '2025-26' }),
  setSchoolYearConfig: setYear,
}));
vi.mock('@/features/setu/rollover/year-readiness', () => ({ computeYearReadiness: readiness }));
vi.mock('@/lib/seva-requirement', () => ({ getSevaRequirement: getSeva, setSevaRequirement: setSeva }));
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: () => ({ role: 'admin', mid: 'A1' }) }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

import { POST } from '../activate/route';
const req = () => new Request('http://x/api/admin/school-year/activate', { method: 'POST' });

beforeEach(() => vi.clearAllMocks());

it('blocks Activate when promotion has not run', async () => {
  readiness.mockResolvedValue({ promotionRan: false });
  const res = await POST(req());
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('promotion-not-run');
  expect(setYear).not.toHaveBeenCalled();
});

it('flips currentYear AND currentSevaYear on success', async () => {
  readiness.mockResolvedValue({ promotionRan: true });
  getSeva.mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  setYear.mockResolvedValue({ currentYear: '2026-27' });
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(setYear).toHaveBeenCalledWith(expect.anything(), { currentYear: '2026-27' }, 'A1');
  expect(setSeva).toHaveBeenCalledWith(expect.objectContaining({ currentSevaYear: '2026-27' }));
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement `activate/route.ts`:**

```ts
import { NextResponse } from 'next/server';
import { revalidateTag, revalidatePath } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig, setSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { computeYearReadiness } from '@/features/setu/rollover/year-readiness';
import { getSevaRequirement, setSevaRequirement } from '@/lib/seva-requirement';

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const db = portalFirestore();
  const { currentYear } = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(currentYear);

  const readiness = await computeYearReadiness(db, { fromYear: currentYear, toYear });
  if (!readiness.promotionRan) {
    return NextResponse.json({ error: 'promotion-not-run', toYear }, { status: 409 });
  }

  const config = await setSchoolYearConfig(db, { currentYear: toYear }, session.mid ?? session.uid ?? 'unknown');
  const seva = await getSevaRequirement();
  await setSevaRequirement({ ...seva, currentSevaYear: toYear });

  revalidateTag('school-year', 'max'); // badges
  revalidatePath('/admin/school-year');
  return NextResponse.json({ config, sevaYear: toYear }, { status: 200 });
}
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: copy-calendar route** — `copy-calendar/route.ts` (admin-only; calls `cloneCalendarYear(db, { fromYear: currentYear, toYear: next, dryRun: false })`, returns `CalendarCopyResult`, revalidates nothing user-facing). Add a small test asserting 403 for non-admin + a happy path with `cloneCalendarYear` mocked.

- [ ] **Step 6: Extend GET** in `school-year/route.ts` to also return `readiness: await computeYearReadiness(db, { fromYear: config.currentYear, toYear: deriveNextSchoolYear(config.currentYear) })`. Update `routes.test.ts` to assert the `readiness` key.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/api/admin/school-year
git commit -m "feat(api): school-year Activate (currentYear+seva, gated) + copy-calendar + readiness in GET"
```

---

## Task 7: Year-center UI (readiness checklist + copy buttons + Activate)

**Files:**
- Modify: `apps/portal/src/features/setu/rollover/rollover-client.ts`
- Create: `apps/portal/src/features/setu/rollover/components/year-readiness-checklist.tsx`
- Modify: `apps/portal/src/features/setu/rollover/components/rollover-page.tsx`
- Test: `apps/portal/src/features/setu/rollover/components/__tests__/year-readiness-checklist.test.tsx`

- [ ] **Step 1: Client fns** — append to `rollover-client.ts`:

```ts
import { YearReadinessSchema, CalendarCopyResultSchema, type YearReadiness, type CalendarCopyResult } from '@cmt/shared-domain';

/** Activate next year (flip live year + align seva). Throws on 409 promotion-not-run. */
export async function activateSchoolYearClient(): Promise<SchoolYearConfig> {
  const payload = await sendJson('/api/admin/school-year/activate', {});
  return SchoolYearConfigSchema.parse((payload as { config: unknown }).config);
}
export async function copyCalendarFromLastYearClient(): Promise<CalendarCopyResult> {
  return CalendarCopyResultSchema.parse(await sendJson('/api/admin/school-year/copy-calendar', {}));
}
```
(For the 409 case, have `sendJson` surface the body so the UI can show "Promote families first." — adjust `sendJson` to throw an Error carrying the parsed `{error}` for non-OK, or add a variant.)

- [ ] **Step 2: Write the failing checklist test** — renders `<YearReadinessChecklist readiness={...} />` and asserts ✓/✗ rows + that the Activate button is **disabled** when `promotionRan:false`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { YearReadinessChecklist } from '../year-readiness-checklist';

it('disables Activate until promotion has run', () => {
  render(<YearReadinessChecklist readiness={{ toYear: '2026-27', promotionRan: false, offerings: true, levels: true, calendar: false, teachers: false, prasad: false, seva: false }} onActivate={() => {}} onCopyCalendar={() => {}} activating={false} />);
  expect(screen.getByRole('button', { name: /Activate 2026-27/i })).toBeDisabled();
  expect(screen.getByText(/Calendar/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run — FAIL. Implement `year-readiness-checklist.tsx`** — a `.csp` card listing the six items with ✓/✗, a "Copy from last year" button on the Calendar row (calls `onCopyCalendar`), and an `Activate {toYear}` button `disabled={!readiness.promotionRan || activating}` with helper text "Promote families before activating." Follow the visual style of the existing `start-step.tsx`/`promote-step.tsx`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Wire into `rollover-page.tsx`** — fetch readiness (from the extended GET) into state; render `<YearReadinessChecklist>` below the existing Step 2 (Promote); on Activate, call `activateSchoolYearClient()`, then refresh the page state (the live year flips → the header "Current school year" + badge update); show a success toast. Keep the existing Edit/Start/Promote intact. Surface the 409 as a clear toast ("Promote families first").

- [ ] **Step 6: Run** the rollover component tests: `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover`. Fix fallout.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/rollover
git commit -m "feat(rollover): Year center readiness checklist + copy-calendar + Activate"
```

---

## Task 8: Deployed-UAT E2E + fixture

**Files:**
- Create: `apps/portal/scripts/seed-year-center-fixture.ts`
- Modify: `apps/portal/package.json` (alias `seed:year-center-fixture`), `apps/portal/e2e/_helpers.ts`
- Create: `apps/portal/e2e/setu/admin/year-center.spec.ts`

> Per `verifying-setu-changes-in-uat`: a **realistic multi-year fixture** + a walkthrough against deployed UAT.

- [ ] **Step 1: Fixture seed** (`seed-year-center-fixture.ts`, UAT-guarded, idempotent): provision a small BV _test setup that mirrors a real pre-rollover state — an admin password user (reuse `seed-test-accounts` admin), a `bv-brampton-{liveYear}` offering+levels+a few active enrollments with graded children, the live year set, and **no** next-year data. (Reuse `registerFamily`/direct writes like the other seeds; reuse the existing rollover engine helpers where possible.) Refuse unless `PORTAL_FIREBASE_PROJECT_ID==='chinmaya-setu-uat'`. Snapshot-fed only (never live RTDB).

- [ ] **Step 2: Add alias** to `package.json`: `"seed:year-center-fixture": "tsx --env-file=.env.local scripts/seed-year-center-fixture.ts"`. Add creds to `e2e/_helpers.ts`.

- [ ] **Step 3: Write the spec** `year-center.spec.ts` (project `setu`, against `PLAYWRIGHT_BASE_URL`): sign in as admin (password), `beforeAll` re-seeds. Walk:
  1. `/admin/school-year` → badge/header shows live year; **Activate is disabled** (promotion not run).
  2. **Start** → 2026-27 offerings/levels created.
  3. **Copy calendar** → calendar row flips to ✓.
  4. **Preview** promote → fix any "needs attention" → **Promote** (commit).
  5. **Activate 2026-27** now enabled → click → confirm.
  6. Assert: header live year is now **2026-27**; the admin badge reads "School year 2026-27"; (optionally) load `/family` as a fixture family and assert the family badge reads 2026-27.
  Assert via `toHaveURL`/visible text. Handle the shared OTP rate limit with the `failOnRateLimit` helper + `pnpm clear:otp-rate-limit`.

- [ ] **Step 4: Run vs deployed UAT** (after deploy in the gate):

```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test e2e/setu/admin/year-center.spec.ts --project=setu
```
Expected: green.

- [ ] **Step 5: Runbook** — add a `docs/runbooks/production-cutover-checklist.md` §14 entry (new Activate/copy-calendar routes; any new index; the seva-year-alignment behavior; new seed alias). Commit.

```bash
git add apps/portal/scripts/seed-year-center-fixture.ts apps/portal/package.json apps/portal/e2e docs/runbooks/production-cutover-checklist.md
git commit -m "test(rollover): deployed-UAT E2E for the Year center + multi-year fixture"
```

---

## Final gate (before declaring Phase 1 done)

- [ ] Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (all green).
- [ ] Push (pre-push hook re-runs the gate) → Vercel deploys.
- [ ] Run the Year-center E2E against deployed UAT — green.
- [ ] Opus code review in a separate lane (per project discipline) before final sign-off.

---

## Self-review (plan vs spec)

- **Spec §1 model** → Tasks 2 (cached live year), 6 (Activate sets currentYear+currentSevaYear), gate via promotionRan. ✓
- **Spec §2 UI (badge)** → Tasks 2–3. *Phase-1 badge is read-only live year (the interactive switcher is Phase 2, per spec phasing).* ✓
- **Spec §3 copy-from-last-year** → levels/offerings (reuse existing `startNewYear` via the current Start button — unchanged) + calendar (Tasks 4, 6, 7). prasad/seva/teacher copy correctly **deferred to Phase 2**. ✓
- **Spec §4 Year center + Activate (gated)** → Tasks 5–7. ✓
- **Spec family/teacher label** → Task 3. ✓
- **Spec seva alignment** → Task 6. ✓
- **Disciplines** → index audit (Tasks 4–5), deployed-UAT E2E (Task 8), role helpers/`isAdmin` (Task 6), canAccessRoute (admin catch-all, confirmed in Task 6), no MOBILE_API_CHANGELOG (admin routes), full vitest before push (Final gate). ✓
- **Open items the executor must verify (not placeholders — real lookups):** the exact `calendarEntryId` signature + `classCalendarEntries` doc shape (Task 4); the real `prasadConfig` year field (Task 5); the repo's fake-firestore helper import (Tasks 4–5); whether `teacherRefs != []`/`oid in` queries need new indexes (Tasks 4–5). Each task says where to confirm.
