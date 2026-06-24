# Academic School-Year Context — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin/welcome view & prepare any school year (Past/Live/Preparing) via a `?year=` switcher across the BV surfaces; keep families on the live year (incl. a calendar fix so preparing-year Sundays stay hidden); add OPTIONAL copy-from-last-year for prasad/seva/teachers; allow read-only past years; and expose the live year to the mobile app.

**Architecture:** No schema change except an **additive** `seva_opportunities.status` value (`'draft'`). The viewing year is a URL `?year=` filter resolved by one shared helper (`resolveViewYear`); year-scoped server pages read it and scope their existing year-tagged reads; family/teacher reads ignore it (live-year only). Copy actions are admin-only `/api/admin/school-year/copy-*` routes reusing the Phase-1 Year-center UI. Two family-facing changes (`GET /api/setu/calendar` content, `GET /api/setu/dashboard` adds `schoolYear`) get MOBILE_API_CHANGELOG entries.

**Tech Stack:** Next.js 16 App Router (cacheComponents), React, TypeScript (exactOptionalPropertyTypes + noUncheckedIndexedAccess), Firestore Admin SDK, Vitest + inline fake-firestore, Playwright (deployed-UAT). Shared types in `@cmt/shared-domain`.

---

## File structure

**Create**
- `apps/portal/src/features/setu/rollover/view-year.ts` — `listKnownSchoolYears(db)` + `resolveViewYear(years, liveYear, rawParam)` → `{ year, status }`.
- `apps/portal/src/features/setu/rollover/components/school-year-switcher.tsx` — client dropdown (years + Preparing/Past strip), sets `?year=`.
- `apps/portal/src/features/setu/rollover/clone-prasad-config.ts` — `clonePrasadConfig(db, {fromYear,toYear,dryRun})`.
- `apps/portal/src/features/setu/rollover/copy-seva-opportunities.ts` — `copySevaOpportunities(db, {fromYear,toYear,oppIds,decideLater,actorMid})`.
- `apps/portal/src/features/setu/rollover/prefill-teachers.ts` — `prefillTeachers(db, {fromYear,toYear,dryRun})`.
- `apps/portal/src/features/setu/rollover/assert-live-year.ts` — `assertLiveYear(db, year)` guard (throws on non-live).
- `apps/portal/src/app/api/admin/school-year/copy-prasad/route.ts`, `.../copy-seva/route.ts`, `.../copy-teachers/route.ts` — POST (admin-only).
- `apps/portal/e2e/setu/admin/year-switcher.spec.ts` — deployed-UAT E2E.
- `apps/portal/scripts/seed-year-switcher-fixture.ts` — UAT-only multi-year fixture.

**Modify**
- `apps/portal/src/components/chrome/school-year-badge.tsx` — extract the pill so the switcher can reuse it (keep `SchoolYearBadge` for family/teacher).
- `apps/portal/src/features/admin/components/admin-sidebar.tsx` (+ `app/admin/layout.tsx`, `app/welcome/layout.tsx`) — render the switcher (admin/welcome) instead of the static badge.
- `apps/portal/src/app/admin/levels/page.tsx`, `app/admin/calendar/page.tsx`, `app/admin/prasad/page.tsx`, `app/welcome/seva/page.tsx`, `app/welcome/reports/page.tsx`, `app/welcome/roster/page.tsx` — read `?year=` and scope reads.
- `apps/portal/src/features/setu/calendar/calendar.ts` — live-year lower bound in `getPublishedCalendar`/`getUpcoming`/`getClassDatesHeld`.
- `apps/portal/src/app/api/setu/dashboard/route.ts` — add `schoolYear`.
- `apps/portal/src/features/setu/seva/get-family-seva-view.ts` — exclude `status:'draft'`.
- `apps/portal/src/features/setu/rollover/rollover-client.ts` + `components/year-readiness-checklist.tsx` + `components/rollover-page.tsx` — copy-prasad/seva/teachers buttons.
- The BV write routes (`/api/admin/levels`, `/api/admin/calendar`, `/api/admin/prasad/*`, seva opportunity create, `/api/admin/teacher-assignments`) — `assertLiveYear` guard.
- `apps/portal/docs/MOBILE_API_CHANGELOG.md` — two entries (dashboard `schoolYear`, calendar scoping, seva `draft`).
- `apps/portal/package.json` — `seed:year-switcher-fixture` alias; `apps/portal/e2e/_helpers.ts` — creds if needed (reuse admin).
- `docs/runbooks/production-cutover-checklist.md` — §14 entry.

**Shared-domain (Modify)**
- `packages/shared-domain/src/setu/schemas/seva.ts` — add `'draft'` to `SevaOpportunityStatus` (additive); export a `SchoolYearStatus` type if useful.

---

## Task 1: `resolveViewYear` helper

**Files:**
- Create: `apps/portal/src/features/setu/rollover/view-year.ts`
- Test: `apps/portal/src/features/setu/rollover/__tests__/view-year.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { resolveViewYear, type SchoolYearStatus } from '../view-year';

const YEARS = ['2024-25', '2025-26', '2026-27']; // sorted ascending

describe('resolveViewYear', () => {
  it('defaults to the live year when the param is absent', () => {
    expect(resolveViewYear(YEARS, '2025-26', null)).toEqual({ year: '2025-26', status: 'live' });
  });
  it('classifies a past / preparing year', () => {
    expect(resolveViewYear(YEARS, '2025-26', '2024-25')).toEqual({ year: '2024-25', status: 'past' });
    expect(resolveViewYear(YEARS, '2025-26', '2026-27')).toEqual({ year: '2026-27', status: 'preparing' });
  });
  it('falls back to live on an unknown/garbage param', () => {
    expect(resolveViewYear(YEARS, '2025-26', '1999-00')).toEqual({ year: '2025-26', status: 'live' });
    expect(resolveViewYear(YEARS, '2025-26', 'garbage')).toEqual({ year: '2025-26', status: 'live' });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover/__tests__/view-year.test.ts`

- [ ] **Step 3: Implement `view-year.ts`**
```ts
import { BALA_VIHAR } from '@cmt/shared-domain';

type Db = FirebaseFirestore.Firestore;

export type SchoolYearStatus = 'past' | 'live' | 'preparing';
export interface ViewYear { year: string; status: SchoolYearStatus; }

/** Years that actually have BV data (offering termLabels), ascending + deduped. */
export async function listKnownSchoolYears(db: Db, liveYear: string): Promise<string[]> {
  const snap = await db.collection('offerings').where('programKey', '==', BALA_VIHAR).get();
  const set = new Set<string>([liveYear]); // live year always selectable
  for (const d of snap.docs) {
    const t = d.data()['termLabel'];
    if (typeof t === 'string' && /^\d{4}-\d{2}$/.test(t)) set.add(t);
  }
  return [...set].sort();
}

/** Resolve the ?year= selection against the known set; fall back to live. */
export function resolveViewYear(years: string[], liveYear: string, raw: string | null): ViewYear {
  const year = raw && years.includes(raw) ? raw : liveYear;
  const status: SchoolYearStatus = year === liveYear ? 'live' : year < liveYear ? 'past' : 'preparing';
  return { year, status };
}
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/src/features/setu/rollover/view-year.ts apps/portal/src/features/setu/rollover/__tests__/view-year.test.ts
git commit -m "feat(rollover): resolveViewYear + listKnownSchoolYears (?year= carrier)"
```

---

## Task 2: Year switcher component

**Files:**
- Create: `apps/portal/src/features/setu/rollover/components/school-year-switcher.tsx`
- Test: `apps/portal/src/features/setu/rollover/components/__tests__/school-year-switcher.test.tsx`

> The switcher is a **client** component (uses `useRouter`/`usePathname`/`useSearchParams`). It receives the known `years` + `liveYear` from a server parent; it reads the current `?year=` itself and, on change, pushes the same path with the new `?year=`. The `.csp`-scoped pill styling mirrors the Phase-1 `SchoolYearBadge`.

- [ ] **Step 1: Write the failing test** (`school-year-switcher.test.tsx`) — mock `next/navigation`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/levels',
  useSearchParams: () => new URLSearchParams(''),
}));

import { SchoolYearSwitcher } from '../school-year-switcher';

it('shows the live year and the Preparing strip after switching', async () => {
  const user = userEvent.setup();
  render(<SchoolYearSwitcher years={['2024-25', '2025-26', '2026-27']} liveYear="2025-26" />);
  // Live year shown, no strip (selected == live).
  expect(screen.getByRole('combobox')).toHaveValue('2025-26');
  expect(screen.queryByText(/not live yet|read-only/i)).not.toBeInTheDocument();
  // Selecting a preparing year pushes ?year= and would show the strip on re-render.
  await user.selectOptions(screen.getByRole('combobox'), '2026-27');
  expect(push).toHaveBeenCalledWith('/admin/levels?year=2026-27');
});
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement `school-year-switcher.tsx`**
```tsx
'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

interface Props { years: string[]; liveYear: string; }

/** Admin/welcome year selector. Reads the current ?year= (defaults to live) and
 *  pushes the same path with the new year. Shows a "not live" / "read-only" strip
 *  when the selection isn't the live year. */
export function SchoolYearSwitcher({ years, liveYear }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get('year');
  const selected = raw && years.includes(raw) ? raw : liveYear;
  const status = selected === liveYear ? 'live' : selected < liveYear ? 'past' : 'preparing';

  function onChange(year: string) {
    const next = new URLSearchParams(params.toString());
    if (year === liveYear) next.delete('year');
    else next.set('year', year);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <span className="csp" style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
        <label htmlFor="sy-switch" style={{ color: 'var(--muted)' }}>School year</label>
        <select
          id="sy-switch"
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px' }}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}{y === liveYear ? ' · Live' : ''}</option>
          ))}
        </select>
      </span>
      {status !== 'live' && (
        <span style={{ fontSize: 11, fontWeight: 600, color: status === 'preparing' ? 'var(--accentDeep)' : 'var(--muted)' }}>
          {status === 'preparing' ? `Preparing ${selected} — not live yet` : `Past year — read-only`}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add apps/portal/src/features/setu/rollover/components/school-year-switcher.tsx apps/portal/src/features/setu/rollover/components/__tests__/school-year-switcher.test.tsx
git commit -m "feat(rollover): SchoolYearSwitcher (?year= dropdown + Preparing/Past strip)"
```

---

## Task 3: Mount the switcher in the admin/welcome shells

**Files (Modify):** `apps/portal/src/app/admin/layout.tsx`, `apps/portal/src/app/welcome/layout.tsx`, `apps/portal/src/features/admin/components/admin-sidebar.tsx`

> The admin/welcome shells render the static `SchoolYearBadge` today (Phase 1). Replace it (for these two shells only) with `<SchoolYearSwitcher years={...} liveYear={...} />`. The server layout computes `years`/`liveYear` and passes them into the client switcher (the switcher is already a client component — pass plain props, not a server element). Family/teacher shells keep the read-only `SchoolYearBadge` (live-year label) unchanged.

- [ ] **Step 1:** In the admin server layout's chrome component (the async one that already passes `yearBadge`), compute:
```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears } from '@/features/setu/rollover/view-year';
import { SchoolYearSwitcher } from '@/features/setu/rollover/components/school-year-switcher';
// ...
const liveYear = await getLiveSchoolYearCached();
const years = await listKnownSchoolYears(portalFirestore(), liveYear);
```
and pass `yearBadge={<SchoolYearSwitcher years={years} liveYear={liveYear} />}` (replacing `<SchoolYearBadge admin />`). `listKnownSchoolYears` is uncached — that's fine inside the already-dynamic, Suspense-wrapped chrome (it's one small offerings read). Do the same in `welcome/layout.tsx`.

- [ ] **Step 2: Manual check** — `pnpm --filter @cmt/portal build` succeeds. No new unit test (placement; the switcher behavior is unit-tested in Task 2, the E2E asserts it in Task 15).

- [ ] **Step 3: Commit**
```bash
git add apps/portal/src/app/admin/layout.tsx apps/portal/src/app/welcome/layout.tsx apps/portal/src/features/admin/components/admin-sidebar.tsx
git commit -m "feat(chrome): year switcher in admin/welcome shells (family/teacher keep the live-year badge)"
```

---

## Task 4: Year-scope Level management (the pattern)

**Files (Modify):** `apps/portal/src/app/admin/levels/page.tsx`

> This page is `async function LevelsPage()` and currently reads **all** levels (`db.collection('levels').orderBy('location').orderBy('order').get()`). It does NOT receive `searchParams`. Add the `searchParams` prop, resolve the view year, and **filter levels to that year** (`periodLabel === viewYear.year`) in memory (cheap — ≤ ~36 BV levels; avoids a new composite index). This is the worked example; Tasks 5–7 follow the same shape.

- [ ] **Step 1:** Change the signature + reads:
```ts
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';

export default async function LevelsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await connection();
  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);
  // ...existing reads, but filter levels to the view year:
  const levels: LevelRow[] = levelsSnap.docs
    .map((d) => /* existing mapping */)
    .filter((l) => l.periodLabel === view.year);
```
(Keep the rest of the page; pass `view` down only if the page needs to show a "read-only — past year" banner — optional in v1, the shell strip already signals it.)

- [ ] **Step 2: Run** `pnpm --filter @cmt/portal exec tsc --noEmit` (Next 16 `searchParams` is a Promise — confirm the await). Build check is in the final gate.

- [ ] **Step 3: Commit**
```bash
git add apps/portal/src/app/admin/levels/page.tsx
git commit -m "feat(admin): Level management reads ?year= (scopes levels to the selected year)"
```

---

## Task 5: Year-scope Class calendar

**Files (Modify):** `apps/portal/src/app/admin/calendar/page.tsx`

- [ ] **Step 1:** READ the page first to see how it derives location/year today. Add `searchParams`, resolve `view` (as in Task 4), and scope the admin calendar read to `schoolYearDateRange(view.year)` (the admin read is `getCalendarSerialized(location)` — extend it or filter the returned entries to the year's date window). If the admin calendar read needs a new `(location, date)`-range query, audit `firestore.indexes.json` (the `(location, programKey, date)` + `(location, date)` indexes already exist) — prefer the existing index or in-memory date filter.

- [ ] **Step 2: Commit**
```bash
git add apps/portal/src/app/admin/calendar/page.tsx firestore.indexes.json
git commit -m "feat(admin): Class calendar reads ?year= (scopes entries to the selected year window)"
```

---

## Task 6: Year-scope Prasad + Seva

**Files (Modify):** `apps/portal/src/app/admin/prasad/page.tsx`, `apps/portal/src/app/welcome/seva/page.tsx`

- [ ] **Step 1 (prasad):** READ the page. It currently uses `getCurrentPrasadPeriods(db)` (live year). Add `searchParams`; when `?year=` is a non-live year, resolve the prasad periods for THAT year via `fallbackPrasadPeriodsForYear(view.year)` / the offerings for that year (mirror `getCurrentPrasadPeriods` but for the selected year). Scope the prasad reads (`prasadConfig`/`prasadAssignments` by the year's pid) accordingly.

- [ ] **Step 2 (seva):** READ the page. It uses the seva year (`getSevaRequirement().currentSevaYear`). Add `searchParams`; scope `listOpportunities({ sevaYear: view.year })` to the selected year instead of the live seva year.

- [ ] **Step 3: Commit**
```bash
git add apps/portal/src/app/admin/prasad/page.tsx apps/portal/src/app/welcome/seva/page.tsx
git commit -m "feat(admin): Prasad + Seva surfaces read ?year="
```

---

## Task 7: Year-scope Reports + roster

**Files (Modify):** `apps/portal/src/app/welcome/reports/page.tsx`, `apps/portal/src/app/welcome/roster/page.tsx`

- [ ] **Step 1:** READ both pages. Add `searchParams`; thread `view.year` into the existing year-scoped report/roster reads (enrollment headcounts, attendance, donations by period — replace the live-year default with `view.year`). Roster: scope the enrollment/program reads to the selected year's oids. Audit any new compound query against `firestore.indexes.json` (UAT-only deploy).

- [ ] **Step 2: Commit**
```bash
git add apps/portal/src/app/welcome/reports/page.tsx apps/portal/src/app/welcome/roster/page.tsx firestore.indexes.json
git commit -m "feat(welcome): Reports + roster read ?year="
```

---

## Task 8: Family/teacher calendar live-year lower bound (mobile-facing)

**Files:**
- Modify: `apps/portal/src/features/setu/calendar/calendar.ts`
- Test: `apps/portal/src/features/setu/calendar/__tests__/calendar.test.ts` (add cases)
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

> `getPublishedCalendar`/`getUpcoming`/`getClassDatesHeld` currently return all enabled entries for a (location, program) regardless of year. Add a **live-year lower bound** so preparing-year (future) Sundays stay hidden until Activate. `getCalendar` reads all (admin chain) — leave it; scope the **published** family/teacher helpers.

- [ ] **Step 1: Write the failing test** — seed two school years of enabled BV entries (e.g. `2025-09-07` and the +364d `2026-09-06`); with `liveYear='2025-26'` assert `getPublishedCalendar` returns only the 2025-26-window entry. (Use the file's existing test fake/mocking pattern — READ the existing calendar test first.)

- [ ] **Step 2: Implement** — add an optional `liveYear` arg (resolved by the caller via `getLiveSchoolYearCached`), and filter `entries` to `e.date >= schoolYearDateRange(liveYear).start`:
```ts
import { schoolYearDateRange } from '@/features/setu/rollover/school-year';
// in getPublishedCalendar(location, programKey, liveYear):
const { start } = schoolYearDateRange(liveYear);
return entries.filter((e) => e.enabled && e.date >= start);
```
Thread `liveYear` through `getUpcoming`/`getClassDatesHeld` and their callers (`/api/setu/calendar`, the dashboard `loadFamilyDashboard`, attendance). `getClassDatesHeld` keeps its `date <= today` upper bound — so it now returns `[start, today]`, which is correct (this year's held Sundays only).

- [ ] **Step 3: Run** the calendar + dashboard + attendance tests — fix fallout (callers now pass `liveYear`).

- [ ] **Step 4: Index audit** — these are post-read in-memory filters (no new query) → no index. Confirm.

- [ ] **Step 5: MOBILE_API_CHANGELOG entry** (newest-first, SHA-keyed — fill the SHA after committing): `GET /api/setu/calendar` now returns only live-school-year-onward entries (prior-year + next-year-prep Sundays excluded). Mobile: the calendar/upcoming list will no longer include other-year dates — update fixtures/expectations; no shape change.

- [ ] **Step 6: Commit**
```bash
git add apps/portal/src/features/setu/calendar/calendar.ts apps/portal/src/features/setu/calendar/__tests__/calendar.test.ts apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "fix(calendar): scope family/teacher published calendar to the live year (hide prep-year Sundays)"
```

---

## Task 9: Copy prasad config from last year (optional)

**Files:**
- Create: `apps/portal/src/features/setu/rollover/clone-prasad-config.ts`
- Create: `apps/portal/src/app/api/admin/school-year/copy-prasad/route.ts`
- Test: `__tests__/clone-prasad-config.test.ts`

> `prasadConfig/{oid}` holds `{ pid, capPerSunday, publishedAt, publishedBy }` (pid == offering oid). Clone the source-year configs to the next-year oids (`balaViharSourceOidsForYear`). Idempotent (skip an existing target).

- [ ] **Step 1: Write the failing test** (inline fake-firestore; seed `prasadConfig/bv-brampton-2025-26` `{capPerSunday: 12}`; clone 2025-26→2026-27; assert `prasadConfig/bv-brampton-2026-27` created with cap 12; re-run creates 0).

- [ ] **Step 2: Implement `clone-prasad-config.ts`**
```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { balaViharSourceOidsForYear } from './school-year';

type Db = FirebaseFirestore.Firestore;
export interface PrasadCopyResult { fromYear: string; toYear: string; created: string[]; existing: string[]; }

export async function clonePrasadConfig(
  db: Db, args: { fromYear: string; toYear: string; dryRun: boolean; actorMid: string },
): Promise<PrasadCopyResult> {
  const fromOids = balaViharSourceOidsForYear(args.fromYear);
  const toOids = balaViharSourceOidsForYear(args.toYear);
  const created: string[] = []; const existing: string[] = [];
  for (let i = 0; i < fromOids.length; i++) {
    const src = await db.collection('prasadConfig').doc(fromOids[i]!).get();
    if (!src.exists) continue;
    const targetId = toOids[i]!;
    const targetRef = db.collection('prasadConfig').doc(targetId);
    if ((await targetRef.get()).exists) { existing.push(targetId); continue; }
    created.push(targetId);
    if (!args.dryRun) {
      await targetRef.set({
        pid: targetId,
        capPerSunday: src.data()!['capPerSunday'],
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: args.actorMid,
      });
    }
  }
  return { fromYear: args.fromYear, toYear: args.toYear, created, existing };
}
```
> Verify the real `prasadConfig` doc fields against `features/setu/prasad/publish-assignments.ts` and match them exactly.

- [ ] **Step 3: Implement the route** (`copy-prasad/route.ts`) — admin-only (`readSessionFromHeaders` + `isAdmin` → 403); derive `fromYear=currentYear`, `toYear=deriveNextSchoolYear`; call `clonePrasadConfig(db, {...,dryRun:false, actorMid})`; return the result. (Mirror the Phase-1 `copy-calendar/route.ts`.) Add a 403-non-admin + happy-path test.

- [ ] **Step 4: Run + commit**
```bash
git add apps/portal/src/features/setu/rollover/clone-prasad-config.ts apps/portal/src/app/api/admin/school-year/copy-prasad
git commit -m "feat(rollover): optional copy prasad config from last year"
```

---

## Task 10: Copy seva opportunities (selective + decide-later draft)

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/seva.ts` (add `'draft'` to `SevaOpportunityStatus`)
- Create: `apps/portal/src/features/setu/rollover/copy-seva-opportunities.ts`
- Create: `apps/portal/src/app/api/admin/school-year/copy-seva/route.ts`
- Modify: `apps/portal/src/features/setu/seva/get-family-seva-view.ts` (exclude drafts)
- Test: `__tests__/copy-seva-opportunities.test.ts`
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

> Selective: the route takes `oppIds` (which of last year's to copy). Each copied opp goes into the new `sevaYear`; if `decideLater` is false the `date` shifts **+364 days** (same weekday) and `status:'open'`; if `decideLater` is true the copy is `status:'draft'` (families never see it) keeping the +364d placeholder date until the admin schedules + opens it. New `oppId` is a fresh id; idempotent on a deterministic `${sourceOppId}-${toYear}` target id.

- [ ] **Step 1: shared-domain** — `export const SevaOpportunityStatus = z.enum(['open', 'closed', 'draft']);` (additive — existing docs still validate). Build shared-domain if prebuilt.

- [ ] **Step 2: Write the failing test** (inline fake-firestore + `vi.mock` FieldValue): seed two `seva_opportunities` in 2025-26; copy only one with `decideLater:false` → asserts one new doc in 2026-27 with date +364 days + `status:'open'`; copy the other with `decideLater:true` → `status:'draft'`. Re-run creates 0.

- [ ] **Step 3: Implement `copy-seva-opportunities.ts`**
```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
type Db = FirebaseFirestore.Firestore;
export interface SevaCopyResult { fromYear: string; toYear: string; created: string[]; existing: string[]; }

function shift364(d: Date): Date { const n = new Date(d); n.setUTCDate(n.getUTCDate() + 364); return n; }

export async function copySevaOpportunities(
  db: Db,
  args: { fromYear: string; toYear: string; oppIds: string[]; decideLater: boolean; actorMid: string },
): Promise<SevaCopyResult> {
  const created: string[] = []; const existing: string[] = [];
  for (const oppId of args.oppIds) {
    const srcSnap = await db.collection('seva_opportunities').doc(oppId).get();
    if (!srcSnap.exists) continue;
    const src = srcSnap.data() as Record<string, unknown>;
    if (src['sevaYear'] !== args.fromYear) continue; // only copy fromYear items
    const targetId = `${oppId}-${args.toYear}`;
    const ref = db.collection('seva_opportunities').doc(targetId);
    if ((await ref.get()).exists) { existing.push(targetId); continue; }
    const srcDate = (src['date'] as { toDate?: () => Date }).toDate?.() ?? new Date(src['date'] as string);
    created.push(targetId);
    const now = FieldValue.serverTimestamp();
    await ref.set({
      oppId: targetId,
      title: src['title'], description: src['description'] ?? '',
      date: shift364(srcDate),
      location: src['location'] ?? '',
      defaultHours: src['defaultHours'],
      capacity: src['capacity'] ?? null,
      sevaYear: args.toYear,
      status: args.decideLater ? 'draft' : 'open',
      createdAt: now, createdBy: args.actorMid, updatedAt: now, updatedBy: args.actorMid,
    });
  }
  return { fromYear: args.fromYear, toYear: args.toYear, created, existing };
}
```

- [ ] **Step 4: Exclude drafts from families** — READ `get-family-seva-view.ts`; ensure the opportunities it surfaces filter `status !== 'draft'` (or `status === 'open'`). Add/extend a test asserting a `draft` opp is not returned.

- [ ] **Step 5: Route** (`copy-seva/route.ts`) — admin-only; body `{ oppIds: string[], decideLater?: boolean }` (Zod-validated); `fromYear=currentYear`, `toYear=next`; call the helper; return the result. 403 + happy-path tests.

- [ ] **Step 6: MOBILE_API_CHANGELOG entry** — `SevaOpportunityStatus` gains `'draft'` (additive); `GET /api/setu/seva/opportunities` excludes drafts (families never see unscheduled copies). Mobile: add `'draft'` to the status enum; ensure the seva list filters it out.

- [ ] **Step 7: Run + commit**
```bash
git add packages/shared-domain apps/portal/src/features/setu/rollover/copy-seva-opportunities.ts apps/portal/src/app/api/admin/school-year/copy-seva apps/portal/src/features/setu/seva/get-family-seva-view.ts apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(rollover): optional selective seva copy (+364d, decide-later draft) + family draft-exclusion"
```

---

## Task 11: Teacher pre-fill from last year (optional)

**Files:**
- Create: `apps/portal/src/features/setu/rollover/prefill-teachers.ts`
- Create: `apps/portal/src/app/api/admin/school-year/copy-teachers/route.ts`
- Test: `__tests__/prefill-teachers.test.ts`

> Maps a source-year level to its next-year twin the **same way `startNewYear` does**: `targetLevelId = sourceLevelId` with the `sourceOid` suffix swapped to `targetOid` (suffix-anchored). Copies `teacherRefs` into the target level ONLY when the target's `teacherRefs` is empty (never clobber an admin assignment). Idempotent.

- [ ] **Step 1: Write the failing test** (inline fake-firestore): seed source level `brampton-grade1-bv-brampton-2025-26` `{ pid:'bv-brampton-2025-26', teacherRefs:['t1','t2'] }` + target level `brampton-grade1-bv-brampton-2026-27` `{ pid:'bv-brampton-2026-27', teacherRefs:[] }`. `prefillTeachers(db,{fromYear:'2025-26',toYear:'2026-27',dryRun:false})` → target `teacherRefs` becomes `['t1','t2']`; a target that already has teachers is left untouched.

- [ ] **Step 2: Implement `prefill-teachers.ts`**
```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { balaViharSourceOidsForYear, targetOidOf } from './school-year';

type Db = FirebaseFirestore.Firestore;
export interface TeacherPrefillResult { fromYear: string; toYear: string; filled: string[]; skipped: string[]; }

function swapLevelId(levelId: string, fromOid: string, toOid: string): string {
  return levelId.endsWith(fromOid) ? levelId.slice(0, -fromOid.length) + toOid : levelId.replace(fromOid, toOid);
}

export async function prefillTeachers(
  db: Db, args: { fromYear: string; toYear: string; dryRun: boolean; actorMid: string },
): Promise<TeacherPrefillResult> {
  const fromOids = balaViharSourceOidsForYear(args.fromYear);
  const filled: string[] = []; const skipped: string[] = [];
  const srcLevels = await db.collection('levels').where('pid', 'in', fromOids).get();
  for (const doc of srcLevels.docs) {
    const lvl = doc.data();
    const refs = (lvl['teacherRefs'] ?? []) as string[];
    if (refs.length === 0) continue;
    const toOid = targetOidOf(String(lvl['pid']), args.fromYear, args.toYear);
    const targetId = swapLevelId(String(lvl['levelId']), String(lvl['pid']), toOid);
    const targetRef = db.collection('levels').doc(targetId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) { skipped.push(targetId); continue; }
    const targetRefs = (targetSnap.data()!['teacherRefs'] ?? []) as string[];
    if (targetRefs.length > 0) { skipped.push(targetId); continue; } // never clobber
    filled.push(targetId);
    if (!args.dryRun) {
      await targetRef.set({ teacherRefs: refs, updatedAt: FieldValue.serverTimestamp(), updatedBy: args.actorMid }, { merge: true });
    }
  }
  return { fromYear: args.fromYear, toYear: args.toYear, filled, skipped };
}
```

- [ ] **Step 3: Route** (`copy-teachers/route.ts`) — admin-only; `fromYear=currentYear`, `toYear=next`; call the helper; return the result. 403 + happy-path tests. **Index note:** `where('pid','in',[...])` is single-field → no composite.

- [ ] **Step 4: Run + commit**
```bash
git add apps/portal/src/features/setu/rollover/prefill-teachers.ts apps/portal/src/app/api/admin/school-year/copy-teachers
git commit -m "feat(rollover): optional teacher pre-fill (carry last year's teacherRefs, never clobber)"
```

---

## Task 12: Wire the optional copy actions into the Year center

**Files (Modify):** `apps/portal/src/features/setu/rollover/rollover-client.ts`, `components/year-readiness-checklist.tsx`, `components/rollover-page.tsx`

- [ ] **Step 1: Client fns** — append to `rollover-client.ts` (mirror `copyCalendarFromLastYearClient`): `copyPrasadFromLastYearClient()`, `copyTeachersFromLastYearClient()`, and `copySevaFromLastYearClient(oppIds, decideLater)` (each parses its result schema; reuse the enhanced `sendJson`).

- [ ] **Step 2: Checklist rows** — in `year-readiness-checklist.tsx`, add a "Copy from last year" action to the **Prasad** and **Teachers** rows (like the Calendar row), each with a busy state. Seva is selective — its row links to a small picker (or a "Copy seva from last year…" affordance that opens the opp list); for v1 a "Copy all open seva" + "decide dates later" checkbox is acceptable if the full picker is deferred (note it).

- [ ] **Step 3: rollover-page handlers** — add `copyPrasad`/`copyTeachers`/`copySeva` handlers (mirror `copyCalendar`: busy state, toast, `router.refresh()`). Make every copy **opt-in** (no auto-run); the page makes clear the admin can run none.

- [ ] **Step 4: Run** `pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover` + commit
```bash
git add apps/portal/src/features/setu/rollover
git commit -m "feat(rollover): Year-center optional copy buttons (prasad/seva/teachers)"
```

---

## Task 13: Past-year write guard + read-only surfaces

**Files:**
- Create: `apps/portal/src/features/setu/rollover/assert-live-year.ts`
- Modify: the BV write routes (levels create/update, calendar create/update, prasad publish/preview, seva opportunity create, teacher-assignments)
- Test: `__tests__/assert-live-year.test.ts`

> A shared guard so a write targeting a non-live year is rejected (defense-in-depth behind the UI read-only state). The guard reads the live year and throws/returns an error when the target year ≠ live.

- [ ] **Step 1: Write the failing test** — `assertLiveYear(db, '2024-25')` with live `'2025-26'` rejects; `assertLiveYear(db, '2025-26')` resolves. (Mock `getSchoolYearConfig` → live year.)

- [ ] **Step 2: Implement `assert-live-year.ts`**
```ts
import { getSchoolYearConfig } from './school-year-config';
type Db = FirebaseFirestore.Firestore;
export class NonLiveYearError extends Error { constructor(public year: string, public liveYear: string) { super('non-live-year'); } }
/** Throw NonLiveYearError when `year` is not the live school year. */
export async function assertLiveYear(db: Db, year: string): Promise<void> {
  const { currentYear } = await getSchoolYearConfig(db);
  if (year !== currentYear) throw new NonLiveYearError(year, currentYear);
}
```

- [ ] **Step 3: Apply at the write routes** — for each BV mutation route that targets a year (derive the target year from the route's payload/path: an offering oid → its termLabel, a level pid → its periodLabel, a calendar entry date → its school year, a seva opp → its sevaYear), call `assertLiveYear` and return `409 { error: 'non-live-year', year, liveYear }` on `NonLiveYearError`. READ each route to find where its target year is known. Add a test per route asserting a past-year write → 409.

- [ ] **Step 4: Read-only UI** — on the year-scoped surfaces, when `view.status !== 'live'` hide/disable the mutate controls (the shell strip already labels it; this prevents the action). Minimal: pass `view.status` to the management component and gate its write buttons.

- [ ] **Step 5: Run + commit**
```bash
git add apps/portal/src/features/setu/rollover/assert-live-year.ts apps/portal/src/app/api/admin apps/portal/src/features
git commit -m "feat(rollover): reject non-live-year writes (assertLiveYear) + read-only past-year surfaces"
```

---

## Task 14: Expose the live year to the mobile dashboard

**Files:**
- Modify: `apps/portal/src/app/api/setu/dashboard/route.ts`
- Test: `apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts` (add/extend)
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

- [ ] **Step 1: Write the failing test** — assert `GET /api/setu/dashboard` response includes a top-level `schoolYear` matching the live year (mock `getLiveSchoolYearCached` → `'2025-26'`). READ the existing dashboard test for its mocking setup.

- [ ] **Step 2: Implement** — in the route, `const schoolYear = await getLiveSchoolYearCached();` and add `schoolYear` to the top level of the JSON (alongside `family`). (`balaVihar.termLabel` stays the family's enrollment period — `schoolYear` is the live operating year.)

- [ ] **Step 3: MOBILE_API_CHANGELOG entry** — `GET /api/setu/dashboard` adds top-level `schoolYear: string` (the live school year). Mobile: add `schoolYear` to the dashboard response schema; render the live-year label on the home screen.

- [ ] **Step 4: Run + commit**
```bash
git add apps/portal/src/app/api/setu/dashboard apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(api): GET /api/setu/dashboard exposes the live schoolYear (mobile live-year label)"
```

---

## Task 15: Deployed-UAT E2E + multi-year fixture

**Files:**
- Create: `apps/portal/scripts/seed-year-switcher-fixture.ts`, `apps/portal/e2e/setu/admin/year-switcher.spec.ts`
- Modify: `apps/portal/package.json`, `docs/runbooks/production-cutover-checklist.md`

> Per `verifying-setu-changes-in-uat`: a realistic multi-year fixture + a deployed-UAT walkthrough. **Non-destructive** re: `app_config` — the spec forbids Activate in the E2E (keeps the clean rollover state). The fixture seeds a Preparing + Past year's data (offerings/levels/calendar/seva) under `_test` ids so the switcher has ≥3 selectable years without flipping the live year.

- [ ] **Step 1: Fixture** (`seed-year-switcher-fixture.ts`, UAT-guarded, idempotent): ensure a Past (`2024-25`) + Preparing (`2026-27`) BV offering+levels (+ a seva opp, a calendar entry) exist alongside the live year, so `listKnownSchoolYears` returns ≥3. Reuse the existing engine helpers; refuse unless `PORTAL_FIREBASE_PROJECT_ID==='chinmaya-setu-uat'`.

- [ ] **Step 2: Spec** (`year-switcher.spec.ts`, project `setu`, reuse storageState admin auth, `test.skip(!hasFamilyCreds)`): (1) `/admin/levels` → the switcher lists ≥3 years; (2) select Preparing → URL gains `?year=2026-27`, the "Preparing — not live yet" strip shows, the levels list reflects that year; (3) select Past → "read-only" strip, a mutate control is absent/disabled; (4) GET `/api/setu/calendar` does NOT include a preparing-year date; (5) GET `/api/setu/dashboard` has `schoolYear` = live year. **No Activate, no copy that mutates shared live data** (run copies only against the `_test` preparing year, or assert the buttons exist without clicking destructive ones).

- [ ] **Step 3: Run vs deployed UAT** (after deploy in the gate): `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test e2e/setu/admin/year-switcher.spec.ts --project=setu` → green.

- [ ] **Step 4: Runbook §14 entry** — new copy-* routes, the seva `draft` status, dashboard `schoolYear`, calendar scoping, any new index; deploy order for prod (indexes first, no `--force` on 715b8, then code). Commit.
```bash
git add apps/portal/scripts/seed-year-switcher-fixture.ts apps/portal/package.json apps/portal/e2e docs/runbooks/production-cutover-checklist.md
git commit -m "test(rollover): deployed-UAT E2E for the year switcher + multi-year fixture"
```

---

## Final gate (before declaring Phase 2 done)

- [ ] Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (all green).
- [ ] Deploy any new index to UAT only (`--project chinmaya-setu-uat`, never `--force`, never prod).
- [ ] Push (pre-push hook re-runs the gate) → Vercel deploys.
- [ ] Run the year-switcher E2E against deployed UAT — green.
- [ ] Opus code review in a separate lane before sign-off.
- [ ] Confirm MOBILE_API_CHANGELOG has entries for: calendar scoping (Task 8), seva `draft` (Task 10), dashboard `schoolYear` (Task 14) — each SHA-keyed to its commit.

---

## Self-review (plan vs spec)

- **Spec §model / carrier** → Task 1 (`resolveViewYear`, `?year=`, derive-from-termLabels). ✓
- **Spec §1 switcher** → Tasks 2–3. ✓
- **Spec §2 year-scoped surfaces** → Tasks 4–7 (Level/Calendar/Prasad/Seva/Reports/roster). ✓
- **Spec §3 calendar fix (mobile)** → Task 8 (+ changelog). ✓
- **Spec §4 copy-from-last-year, ALL OPTIONAL** → Tasks 9–12 (prasad/seva/teachers, opt-in buttons; Start/Copy-calendar already exist). ✓
- **Spec §5 past-year read-only + assertLiveYear** → Task 13. ✓
- **Spec §6 mobile** → Task 8 (calendar) + Task 10 (seva draft) + Task 14 (dashboard schoolYear), each with a changelog entry. ✓
- **Spec testing** → Task 15 (deployed-UAT, non-destructive, multi-year fixture). ✓
- **Disciplines** → index audits (Tasks 5/7/8/11 call them out), role helpers (Tasks 9/11/13 use isAdmin), canAccessRoute admin catch-all (copy-* routes), MOBILE_API_CHANGELOG (Tasks 8/10/14), full vitest (Final gate), exactOptional/noUnchecked (throughout). ✓
- **Open items the executor must verify (not placeholders — real lookups, each task says where):** the calendar page's current year/location derivation (T5); the prasad + seva + reports + roster pages' current reads (T6–T7); `prasadConfig` real fields (T9); `get-family-seva-view` draft-exclusion point (T10); each write route's target-year derivation for `assertLiveYear` (T13); the existing dashboard/calendar test mocking setup (T8/T14).
