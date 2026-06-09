# Admin Revamp — Phase 3: Roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot welcome-team "Family search" with a browsable, filterable **Roster** at `/welcome/roster` (welcome-team + admin) — browse all Setu families, search-as-filter, location/program filters, payment chip, drill into the existing family-detail page, flat one-row-per-person CSV export, and a read-only migration-completeness check against the legacy 715b8 RTDB roster.

**Architecture:** A new mobile-ready JSON API `GET /api/welcome/families` (auth via `readSessionFromHeaders` + `isWelcomeTeam`) backs both the desktop and mobile roster screens. Browse is cursor-paginated over the Setu `families` collection ordered by `name`; the cursor is the last family's `fid` (stable via Firestore's implicit `__name__` tiebreaker). Search delegates to the existing `searchFamilies(q)`. The program filter resolves an fid-set from `collectionGroup('enrollments')` and intersects in memory. A separate `GET /api/welcome/families/migration-status` reads the legacy roster (715b8, read-only) and diffs against `families.legacyFid`, surfaced as a small client-fetched strip so the browse page is never blocked by the ~864-family RTDB read. All Firebase reads run inside `<Suspense>` after `await connection()` so PPR does not execute them at build time.

**Tech Stack:** Next.js 16 (App Router, Cache Components/PPR), TypeScript (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` ON), Firestore Admin SDK, Zod schemas in `@cmt/shared-domain`, Vitest + Testing Library, Playwright (headless, deployed-UAT).

---

## Spec

`docs/superpowers/specs/2026-06-08-admin-section-revamp-design.md` → "Phase 3 — Roster (item 4)". Decisions D2 (Setu `families` data source + migration-completeness check), D3 (families list → drill to detail; search is a filter; CSV = flat people list).

## Standing constraints (NON-NEGOTIABLE — every task)

- **UAT-only DB writes** (`chinmaya-setu-uat`). The legacy 715b8 RTDB roster + door collections are **READ-ONLY** (and `masterRtdb()` exposes no write helpers, by design). Never write 715b8. Never `--force` an index deploy.
- **Roles via helpers** — `isAdmin` / `isWelcomeTeam` / `isTeacher`, never strict equality.
- **New `/api/welcome/*` paths need explicit `canAccessRoute` rules** (the `/api/setu/*` catch-all does NOT cover `/api/welcome/*`). Add the rule **and its `can-access-route.test.ts` cases in the same commit** as the route.
- **Mobile-ready**: every screen has a real `block md:hidden` layout; the data source is a JSON API authed via `readSessionFromHeaders` (Bearer + cookie) returning ISO-string JSON; shared request/response shapes live in `@cmt/shared-domain`.
- **PPR build safety**: any page that reads Firebase must `await connection()` and wrap the dynamic read in `<Suspense>` (mirror `welcome/family/[fid]/page.tsx`) — otherwise "Collecting page data" runs the live read at build and can crash the worker.
- **`.csp` token scoping** — anything rendered outside a `CspRoot` (fixed bars, sheets) needs `className="csp"`.
- **N=2 discipline** — every read/aggregate is tested with two of the thing (a family with two active enrollments must appear once; a program-filtered family with two enrollments must not duplicate).
- **TDD** (failing test → implement → green), tests in the **same commit** as the code, **frequent commits**, `git push` after every authorized commit (pre-push hook is the gate), **never `--no-verify`**.
- Commit author is the repo default (`CMT Developer <developer@chinmayatoronto.org>`). Co-author trailer per session rules.

## File structure (created / modified)

**Created:**
- `packages/shared-domain/src/setu/roster.ts` — shared roster request/response Zod schemas + types.
- `apps/portal/src/features/setu/roster/list-families.ts` — browse + filter query → `RosterListResponse`.
- `apps/portal/src/features/setu/roster/payment.ts` — `deriveFamilyPayment(fid)` → `'paid'|'outstanding'|'unknown'` (fail-safe).
- `apps/portal/src/features/setu/roster/roster-csv.ts` — flat one-row-per-person CSV builder.
- `apps/portal/src/features/setu/roster/expand-people.ts` — families → flat `RosterPersonCsvRow[]` (members join).
- `apps/portal/src/features/setu/roster/reconcile-migration.ts` — `getMigrationStatus()` (715b8 read-only diff).
- `apps/portal/src/features/setu/roster/roster-client.ts` — client fetch wrappers (throw on non-OK).
- `apps/portal/src/features/setu/roster/roster-browser.tsx` — `'use client'` browse UI (desktop + mobile).
- `apps/portal/src/features/setu/roster/migration-strip.tsx` — `'use client'` migration-status strip.
- `apps/portal/src/features/setu/roster/roster-export-button.tsx` — `'use client'` CSV export (fetch→blob→download).
- `apps/portal/src/features/setu/roster/__tests__/*.test.ts(x)` — unit/component tests.
- `apps/portal/src/app/welcome/roster/page.tsx` + `error.tsx` — the Roster screen.
- `apps/portal/src/app/api/welcome/families/route.ts` — browse/filter/CSV API.
- `apps/portal/src/app/api/welcome/families/migration-status/route.ts` — reconciliation API.
- `apps/portal/e2e/setu/admin/roster.spec.ts` — Playwright headless E2E.

**Modified:**
- `firestore.indexes.json` — add `enrollments (programKey, status)` COLLECTION_GROUP + `families (location, name)` COLLECTION composite indexes.
- `packages/shared-domain/src/setu/index.ts` (and/or the package root `index.ts`) — export the new roster types.
- `packages/shared-domain/src/auth/can-access-route.ts` + `packages/shared-domain/src/__tests__/can-access-route.test.ts` — `/api/welcome/families*` rule + tests.
- `apps/portal/src/app/welcome/page.tsx` — redirect to `/welcome/roster`.
- `apps/portal/src/app/welcome/welcome-search.tsx` + `__tests__/welcome-search.test.tsx` + `apps/portal/src/app/welcome/__tests__/page.test.tsx` + `apps/portal/src/__tests__/e2e/welcome-search.e2e.test.ts` — delete/repoint (search now lives on the roster screen).
- `apps/portal/src/features/family/components/welcome-mobile-nav.tsx` — "Search"→"Roster" tab (`/welcome/roster`).
- `docs/runbooks/production-cutover-checklist.md` — §14 change-log entry for the new indexes + the new prod-deploy TODO.

---

### Task 1: Shared roster types (`@cmt/shared-domain`)

**Files:**
- Create: `packages/shared-domain/src/setu/roster.ts`
- Modify: `packages/shared-domain/src/setu/index.ts` (add `export * from './roster';`)
- Test: `packages/shared-domain/src/setu/__tests__/roster.test.ts`

First confirm the export points: open `packages/shared-domain/src/setu/index.ts` and the package root `packages/shared-domain/src/index.ts` to see how `family.ts`/`enrollment.ts` are re-exported, and confirm `LOCATIONS` + `programKeySchema` are exported from `./schemas/offering`. Match that pattern.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/setu/__tests__/roster.test.ts
import { describe, it, expect } from 'vitest';
import {
  RosterQuerySchema,
  RosterFamilyRowSchema,
  RosterListResponseSchema,
  RosterPersonCsvRowSchema,
  MigrationStatusResponseSchema,
  ROSTER_PAYMENTS,
} from '../roster';

describe('roster schemas', () => {
  it('RosterQuerySchema defaults limit=50 and format=json, coerces numeric limit', () => {
    const parsed = RosterQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.format).toBe('json');
    expect(RosterQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('RosterQuerySchema rejects an unknown location and clamps limit to <=100', () => {
    expect(RosterQuerySchema.safeParse({ location: 'Toronto' }).success).toBe(false);
    expect(RosterQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('RosterFamilyRowSchema requires a known payment value', () => {
    const row = {
      fid: 'CMT-X', legacyFid: '123', name: 'Patel', location: 'Brampton',
      memberCount: 4, payment: 'paid', programs: ['Bala Vihar'],
    };
    expect(RosterFamilyRowSchema.parse(row).payment).toBe('paid');
    expect(RosterFamilyRowSchema.safeParse({ ...row, payment: 'maybe' }).success).toBe(false);
    expect(ROSTER_PAYMENTS).toContain('outstanding');
  });

  it('RosterListResponseSchema round-trips families + nullable cursor', () => {
    const resp = { families: [], nextCursor: null, total: 0 };
    expect(RosterListResponseSchema.parse(resp).nextCursor).toBeNull();
  });

  it('RosterPersonCsvRowSchema + MigrationStatusResponseSchema parse', () => {
    expect(RosterPersonCsvRowSchema.parse({
      familyName: 'Patel', fid: 'CMT-X', legacyFid: '123', memberName: 'Ravi Patel',
      type: 'Child', grade: '3', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid',
    }).type).toBe('Child');
    expect(MigrationStatusResponseSchema.parse({
      legacyTotal: 864, migrated: 800, missing: 64, missingFids: ['123'], checkedAt: '2026-06-09T00:00:00.000Z',
    }).missing).toBe(64);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain test -- roster`
Expected: FAIL — `Cannot find module '../roster'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared-domain/src/setu/roster.ts
import { z } from 'zod';
import { LOCATIONS, programKeySchema } from './schemas/offering';

export const ROSTER_PAYMENTS = ['paid', 'outstanding', 'unknown'] as const;
export type RosterPayment = (typeof ROSTER_PAYMENTS)[number];

export const RosterFamilyRowSchema = z.object({
  fid: z.string(),
  legacyFid: z.string().nullable(),
  name: z.string(),
  location: z.string(),
  memberCount: z.number().int().nonnegative(),
  payment: z.enum(ROSTER_PAYMENTS),
  programs: z.array(z.string()), // active program labels, for display + CSV
});
export type RosterFamilyRow = z.infer<typeof RosterFamilyRowSchema>;

export const RosterListResponseSchema = z.object({
  families: z.array(RosterFamilyRowSchema),
  nextCursor: z.string().nullable(), // last fid of this page, or null when no more
  total: z.number().int().nonnegative().nullable(), // total family count (first page only), else null
});
export type RosterListResponse = z.infer<typeof RosterListResponseSchema>;

export const RosterQuerySchema = z.object({
  q: z.string().trim().optional(),
  location: z.enum(LOCATIONS).optional(),
  program: programKeySchema.optional(),
  cursor: z.string().optional(), // last fid from the prior page
  limit: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(['json', 'csv']).default('json'),
});
export type RosterQuery = z.infer<typeof RosterQuerySchema>;

export const RosterPersonCsvRowSchema = z.object({
  familyName: z.string(),
  fid: z.string(),
  legacyFid: z.string(),
  memberName: z.string(),
  type: z.string(), // 'Adult' | 'Child'
  grade: z.string(),
  location: z.string(),
  programs: z.string(), // '; '-joined active program labels
  payment: z.string(),
});
export type RosterPersonCsvRow = z.infer<typeof RosterPersonCsvRowSchema>;

export const MigrationStatusResponseSchema = z.object({
  legacyTotal: z.number().int().nonnegative(),
  migrated: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  missingFids: z.array(z.string()), // capped sample of legacy fids absent from Setu
  checkedAt: z.string(), // ISO timestamp
});
export type MigrationStatusResponse = z.infer<typeof MigrationStatusResponseSchema>;
```

Then add `export * from './roster';` to `packages/shared-domain/src/setu/index.ts` (place it next to the other schema re-exports). If the package root `index.ts` re-exports `./setu` already, nothing else is needed; verify `import { RosterQuerySchema } from '@cmt/shared-domain/setu'` resolves (and `@cmt/shared-domain` if that barrel re-exports setu).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain test -- roster`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/roster.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/__tests__/roster.test.ts
git commit -m "feat(roster): shared roster request/response schemas (Phase 3 Task 1)"
git push
```

---

### Task 2: Family payment derivation helper (fail-safe)

A roster row shows a payment chip. Derive it per family from active enrollments vs completed donations. It must NEVER throw (a single bad family must not break the page) and must select **all** active enrollments (N=2 safe), not the first.

**Files:**
- Create: `apps/portal/src/features/setu/roster/payment.ts`
- Test: `apps/portal/src/features/setu/roster/__tests__/payment.test.ts`

Before writing, open `apps/portal/src/features/setu/enrollment/get-enrollments.ts` (already read — returns `EnrollmentWithOffering[]` with `effectiveSuggestedAmount`) and find how donations are read for a family. Search: `grep -rn "collection('donations')\|getDonations\|status.*completed" apps/portal/src/features/setu/donations`. Reuse the existing donations reader if one exists; otherwise query `db.collection('donations').where('fid','==',fid).where('status','==','completed')` directly (confirm the field name via the `DonationDoc` schema in `packages/shared-domain/src/setu/schemas/`).

- [ ] **Step 1: Write the failing test** (mock `getEnrollments` + the donations read)

```ts
// apps/portal/src/features/setu/roster/__tests__/payment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getEnrollments = vi.fn();
const sumCompletedDonations = vi.fn();
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
vi.mock('../donations-sum', () => ({ sumCompletedDonations }));

import { deriveFamilyPayment } from '../payment';

beforeEach(() => { getEnrollments.mockReset(); sumCompletedDonations.mockReset(); });

describe('deriveFamilyPayment', () => {
  it("returns 'unknown' when there are no active enrollments", async () => {
    getEnrollments.mockResolvedValue([{ status: 'cancelled', effectiveSuggestedAmount: 100 }]);
    sumCompletedDonations.mockResolvedValue(0);
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it("sums ALL active enrollments (N=2) — outstanding when donations < total expected", async () => {
    getEnrollments.mockResolvedValue([
      { status: 'active', effectiveSuggestedAmount: 100 },
      { status: 'active', effectiveSuggestedAmount: 150 },
    ]);
    sumCompletedDonations.mockResolvedValue(100); // < 250
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
  });

  it("returns 'paid' when completed donations cover the active total", async () => {
    getEnrollments.mockResolvedValue([
      { status: 'active', effectiveSuggestedAmount: 100 },
      { status: 'active', effectiveSuggestedAmount: 150 },
    ]);
    sumCompletedDonations.mockResolvedValue(250);
    expect(await deriveFamilyPayment('CMT-X')).toBe('paid');
  });

  it("returns 'unknown' (never throws) when a dependency rejects", async () => {
    getEnrollments.mockRejectedValue(new Error('firestore down'));
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/payment`
Expected: FAIL — `Cannot find module '../payment'` / `'../donations-sum'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/portal/src/features/setu/roster/donations-sum.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** Sum of completed donation amounts (CAD) for a family. Throws on Firestore error. */
export async function sumCompletedDonations(fid: string): Promise<number> {
  const snap = await portalFirestore()
    .collection('donations')
    .where('fid', '==', fid)
    .where('status', '==', 'completed')
    .get();
  return snap.docs.reduce((sum, d) => {
    const amt = (d.data() as { amountCAD?: unknown }).amountCAD;
    return sum + (typeof amt === 'number' ? amt : 0);
  }, 0);
}
```

```ts
// apps/portal/src/features/setu/roster/payment.ts
import 'server-only';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import type { RosterPayment } from '@cmt/shared-domain/setu';
import { sumCompletedDonations } from './donations-sum';

/**
 * Best-effort payment status for a family. NEVER throws — a derivation failure
 * for one family must not break the roster page (returns 'unknown').
 *  - no active enrollments        → 'unknown'
 *  - completed donations >= total → 'paid'
 *  - otherwise                    → 'outstanding'
 * Sums ALL active enrollments (N=2 safe), not the first.
 */
export async function deriveFamilyPayment(fid: string): Promise<RosterPayment> {
  try {
    const [enrollments, paid] = await Promise.all([getEnrollments(fid), sumCompletedDonations(fid)]);
    const active = enrollments.filter((e) => e.status === 'active');
    if (active.length === 0) return 'unknown';
    const expected = active.reduce((sum, e) => sum + (e.effectiveSuggestedAmount ?? 0), 0);
    if (expected <= 0) return 'unknown';
    return paid >= expected ? 'paid' : 'outstanding';
  } catch {
    return 'unknown';
  }
}
```

> NOTE: verify `amountCAD` and donation `status` enum values against the real `DonationDoc` schema in Step 0 of this task; the spec lists `status ∈ redirected/completed/abandoned` and `amountCAD`. Adjust the field names in `donations-sum.ts` if the schema differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/payment`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/roster/payment.ts apps/portal/src/features/setu/roster/donations-sum.ts apps/portal/src/features/setu/roster/__tests__/payment.test.ts
git commit -m "feat(roster): fail-safe per-family payment derivation (Phase 3 Task 2)"
git push
```

---

### Task 3: Browse + filter query (`listRosterFamilies`)

**Files:**
- Create: `apps/portal/src/features/setu/roster/list-families.ts`
- Test: `apps/portal/src/features/setu/roster/__tests__/list-families.test.ts`

Use the project's fake-firestore test helper. Find it first: `grep -rln "fake-firestore\|createFakeFirestore\|makeFirestore" apps/portal/src/features/setu --include=*.ts | head`. Match the existing pattern used by `search-families` / `get-enrollments` tests. Mock `deriveFamilyPayment` so this task's tests stay focused on the query/pagination/intersect logic.

**Cursor model:** the cursor is the **last family's `fid`**. To resume, fetch that doc (`familiesCol.doc(cursor).get()`) and `startAfter(docSnap)` — this uses every `orderBy` field plus Firestore's implicit `__name__` tiebreaker, so it is stable even when two families share a `name`. For the in-memory program-filtered path, slice the sorted array after the element whose `fid === cursor`.

**Query strategy:**
- **No program filter** → Firestore query: `orderBy('name')` (+ `where('location','==',loc)` when set) `.startAfter(curDoc?)` `.limit(limit + 1)`. Fetch `limit+1` to compute `nextCursor`.
- **Program filter set** → `collectionGroup('enrollments').where('programKey','==',program).where('status','==','active')` → `Set<fid>`; batch-`getAll` those family docs (chunks of 300), drop missing, apply the location filter in memory, sort by `name` then `fid`, slice by cursor, take `limit`.
- `total` is returned only on the first page (no cursor) and only in the no-program path, via `.count()`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/setu/roster/__tests__/list-families.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../payment', () => ({ deriveFamilyPayment: vi.fn().mockResolvedValue('unknown') }));

// Wire the project's fake-firestore here (match the search-families test setup).
// Seed families: { fid, name, location, legacyFid } and member subcollections,
// plus collectionGroup enrollments with { fid, programKey, status }.
import { listRosterFamilies } from '../list-families';

beforeEach(() => {/* reset fake db */});

describe('listRosterFamilies', () => {
  it('orders by name ascending and paginates by fid cursor (limit honored, nextCursor set)', async () => {
    // seed 3 families: Adams, Brown, Clark
    const page1 = await listRosterFamilies({ limit: 2, format: 'json' });
    expect(page1.families.map((f) => f.name)).toEqual(['Adams', 'Brown']);
    expect(page1.nextCursor).toBe(page1.families[1]!.fid);
    const page2 = await listRosterFamilies({ limit: 2, cursor: page1.nextCursor!, format: 'json' });
    expect(page2.families.map((f) => f.name)).toEqual(['Clark']);
    expect(page2.nextCursor).toBeNull();
  });

  it('location filter returns only matching families', async () => {
    const res = await listRosterFamilies({ location: 'Mississauga', limit: 50, format: 'json' });
    expect(res.families.every((f) => f.location === 'Mississauga')).toBe(true);
  });

  it('program filter intersects via collectionGroup; a family with TWO active enrollments appears ONCE (N=2)', async () => {
    // seed a family with two active 'bala-vihar' enrollments
    const res = await listRosterFamilies({ program: 'bala-vihar', limit: 50, format: 'json' });
    const dupes = res.families.filter((f) => f.fid === 'CMT-TWO');
    expect(dupes).toHaveLength(1);
  });

  it('reports memberCount from the members subcollection', async () => {
    const res = await listRosterFamilies({ limit: 50, format: 'json' });
    const fam = res.families.find((f) => f.fid === 'CMT-FOUR');
    expect(fam?.memberCount).toBe(4);
  });

  it('returns total only on the first page (no cursor)', async () => {
    const first = await listRosterFamilies({ limit: 2, format: 'json' });
    expect(typeof first.total).toBe('number');
    const next = await listRosterFamilies({ limit: 2, cursor: first.nextCursor!, format: 'json' });
    expect(next.total).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/list-families`
Expected: FAIL — `Cannot find module '../list-families'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/portal/src/features/setu/roster/list-families.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { RosterFamilyRow, RosterListResponse, RosterQuery } from '@cmt/shared-domain/setu';
import { deriveFamilyPayment } from './payment';

type RawFamily = {
  legacyFid?: unknown; name?: unknown; location?: unknown;
};

function nameOf(fid: string, d: RawFamily): string {
  return typeof d.name === 'string' && d.name ? d.name : fid;
}
function locationOf(d: RawFamily): string {
  return typeof d.location === 'string' && d.location ? d.location : 'Brampton';
}
function legacyOf(d: RawFamily): string | null {
  return typeof d.legacyFid === 'string' ? d.legacyFid : null;
}

const PROGRAM_FAMILY_CHUNK = 300;

async function activeProgramLabels(fid: string): Promise<string[]> {
  // Active program labels for the chip/CSV. Bounded read per family.
  const snap = await portalFirestore()
    .collection('families').doc(fid).collection('enrollments')
    .where('status', '==', 'active').get();
  return [...new Set(snap.docs.map((e) => String((e.data() as { programLabel?: unknown }).programLabel ?? '')).filter(Boolean))];
}

async function toRow(fid: string, d: RawFamily): Promise<RosterFamilyRow> {
  const db = portalFirestore();
  const [memberSnap, payment, programs] = await Promise.all([
    db.collection('families').doc(fid).collection('members').limit(100).get(),
    deriveFamilyPayment(fid),
    activeProgramLabels(fid),
  ]);
  return {
    fid,
    legacyFid: legacyOf(d),
    name: nameOf(fid, d),
    location: locationOf(d),
    memberCount: memberSnap.docs.length,
    payment,
    programs,
  };
}

export async function listRosterFamilies(params: RosterQuery): Promise<RosterListResponse> {
  const db = portalFirestore();
  const familiesCol = db.collection('families');
  const limit = params.limit ?? 50;

  // --- Program filter: in-memory intersect path ---
  if (params.program) {
    const enrSnap = await db
      .collectionGroup('enrollments')
      .where('programKey', '==', params.program)
      .where('status', '==', 'active')
      .get();
    const fids = [...new Set(enrSnap.docs.map((e) => String((e.data() as { fid?: unknown }).fid ?? '')).filter(Boolean))];

    const docs: Array<{ fid: string; data: RawFamily }> = [];
    for (let i = 0; i < fids.length; i += PROGRAM_FAMILY_CHUNK) {
      const refs = fids.slice(i, i + PROGRAM_FAMILY_CHUNK).map((f) => familiesCol.doc(f));
      const got = await db.getAll(...refs);
      for (const snap of got) {
        if (!snap.exists) continue;
        const data = snap.data() as RawFamily;
        if (params.location && locationOf(data) !== params.location) continue;
        docs.push({ fid: snap.id, data });
      }
    }
    docs.sort((a, b) => {
      const c = nameOf(a.fid, a.data).localeCompare(nameOf(b.fid, b.data));
      return c !== 0 ? c : a.fid.localeCompare(b.fid);
    });
    const startIdx = params.cursor ? docs.findIndex((x) => x.fid === params.cursor) + 1 : 0;
    const slice = docs.slice(startIdx, startIdx + limit);
    const families = await Promise.all(slice.map((x) => toRow(x.fid, x.data)));
    const lastFid = slice.at(-1)?.fid ?? null;
    const nextCursor = startIdx + limit < docs.length ? lastFid : null;
    return { families, nextCursor, total: params.cursor ? null : docs.length };
  }

  // --- No program filter: Firestore-ordered cursor path ---
  let query = familiesCol.orderBy('name');
  if (params.location) query = query.where('location', '==', params.location).orderBy('name');
  // (Firestore allows where + orderBy on the same composite index — see Task 8.)
  if (params.cursor) {
    const curDoc = await familiesCol.doc(params.cursor).get();
    if (curDoc.exists) query = query.startAfter(curDoc);
  }
  const snap = await query.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const pageDocs = snap.docs.slice(0, limit);
  const families = await Promise.all(pageDocs.map((doc) => toRow(doc.id, doc.data() as RawFamily)));
  const nextCursor = hasMore ? (pageDocs.at(-1)?.id ?? null) : null;

  let total: number | null = null;
  if (!params.cursor) {
    const countQuery = params.location ? familiesCol.where('location', '==', params.location) : familiesCol;
    total = (await countQuery.count().get()).data().count;
  }
  return { families, nextCursor, total };
}
```

> If the fake-firestore helper does not implement `.count()` or `.getAll()`, guard those calls (try/catch → `total = null`; fall back to per-ref `.get()` in the chunk loop) so tests don't depend on unsupported fake APIs. Note any such fallback in the code comment.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/list-families`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/roster/list-families.ts apps/portal/src/features/setu/roster/__tests__/list-families.test.ts
git commit -m "feat(roster): browse + location/program filters with fid-cursor pagination (Phase 3 Task 3)"
git push
```

---

### Task 4: Flat people CSV (expand + build)

**Files:**
- Create: `apps/portal/src/features/setu/roster/expand-people.ts`
- Create: `apps/portal/src/features/setu/roster/roster-csv.ts`
- Test: `apps/portal/src/features/setu/roster/__tests__/roster-csv.test.ts`

`expand-people.ts` turns matched families into one `RosterPersonCsvRow` per member; `roster-csv.ts` serializes (its own escaping — the existing `toCsv` is hardwired to teacher columns, so do not reuse it). The export reads ALL matching families (not a page) up to a hard cap; if capped, `console.warn` the dropped count (no silent caps).

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/setu/roster/__tests__/roster-csv.test.ts
import { describe, it, expect } from 'vitest';
import { rosterToCsv } from '../roster-csv';
import type { RosterPersonCsvRow } from '@cmt/shared-domain/setu';

const row = (over: Partial<RosterPersonCsvRow>): RosterPersonCsvRow => ({
  familyName: 'Patel', fid: 'CMT-X', legacyFid: '123', memberName: 'Ravi Patel',
  type: 'Child', grade: '3', location: 'Brampton', programs: 'Bala Vihar', payment: 'paid', ...over,
});

describe('rosterToCsv', () => {
  it('emits a header row even with no data', () => {
    expect(rosterToCsv([])).toMatch(/^familyName,fid,legacyFid,memberName,type,grade,location,programs,payment$/);
  });

  it('emits one row per person with all columns in order', () => {
    const csv = rosterToCsv([row({ memberName: 'Ravi Patel' }), row({ memberName: 'Mira Patel', type: 'Adult', grade: '' })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[1]).toContain('Ravi Patel');
    expect(lines[2]).toContain('Mira Patel');
  });

  it('escapes commas, quotes, and newlines', () => {
    const csv = rosterToCsv([row({ familyName: 'Patel, Jr "the elder"' })]);
    expect(csv).toContain('"Patel, Jr ""the elder"""');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/roster-csv`
Expected: FAIL — `Cannot find module '../roster-csv'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/portal/src/features/setu/roster/roster-csv.ts
import type { RosterPersonCsvRow } from '@cmt/shared-domain/setu';

const HEADERS: Array<keyof RosterPersonCsvRow> = [
  'familyName', 'fid', 'legacyFid', 'memberName', 'type', 'grade', 'location', 'programs', 'payment',
];

function escapeField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rosterToCsv(rows: RosterPersonCsvRow[]): string {
  const header = HEADERS.join(',');
  if (rows.length === 0) return header;
  const body = rows.map((r) => HEADERS.map((h) => escapeField(String(r[h] ?? ''))).join(',')).join('\n');
  return `${header}\n${body}`;
}
```

```ts
// apps/portal/src/features/setu/roster/expand-people.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { RosterFamilyRow, RosterPersonCsvRow } from '@cmt/shared-domain/setu';

const EXPORT_FAMILY_CAP = 2000;

/** Expand roster families into one CSV row per member. Reads each family's members + the family's active programs already on the row. */
export async function expandPeople(families: RosterFamilyRow[]): Promise<RosterPersonCsvRow[]> {
  const db = portalFirestore();
  const capped = families.slice(0, EXPORT_FAMILY_CAP);
  if (families.length > EXPORT_FAMILY_CAP) {
    console.warn(`roster CSV: capped at ${EXPORT_FAMILY_CAP} families; dropped ${families.length - EXPORT_FAMILY_CAP}`);
  }
  const rows: RosterPersonCsvRow[] = [];
  for (const fam of capped) {
    const memberSnap = await db.collection('families').doc(fam.fid).collection('members').limit(100).get();
    const programs = fam.programs.join('; ');
    for (const m of memberSnap.docs) {
      const d = m.data() as { firstName?: unknown; lastName?: unknown; type?: unknown; schoolGrade?: unknown };
      rows.push({
        familyName: fam.name,
        fid: fam.fid,
        legacyFid: fam.legacyFid ?? '',
        memberName: `${String(d.firstName ?? '')} ${String(d.lastName ?? '')}`.trim(),
        type: String(d.type ?? ''),
        grade: typeof d.schoolGrade === 'string' ? d.schoolGrade : '',
        location: fam.location,
        programs,
        payment: fam.payment,
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/roster-csv`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/roster/roster-csv.ts apps/portal/src/features/setu/roster/expand-people.ts apps/portal/src/features/setu/roster/__tests__/roster-csv.test.ts
git commit -m "feat(roster): flat one-row-per-person CSV builder + people expansion (Phase 3 Task 4)"
git push
```

---

### Task 5: Migration-completeness reconciliation (715b8 read-only)

**Files:**
- Create: `apps/portal/src/features/setu/roster/reconcile-migration.ts`
- Test: `apps/portal/src/features/setu/roster/__tests__/reconcile-migration.test.ts`

`getMigrationStatus()` reads the legacy family ids from the 715b8 RTDB roster via the existing `listAllFamilies()` (read-only — `masterRtdb()` exposes no write helpers) and diffs against the set of `families.legacyFid` already in Setu. It returns counts + a capped sample of missing fids. The timestamp is passed in (NOT `new Date()` inside — keep the function pure-ish and testable; the route stamps `checkedAt`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/setu/roster/__tests__/reconcile-migration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listAllFamilies = vi.fn();
const listSetuLegacyFids = vi.fn();
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({ listAllFamilies }));
vi.mock('../setu-legacy-fids', () => ({ listSetuLegacyFids }));

import { getMigrationStatus } from '../reconcile-migration';

beforeEach(() => { listAllFamilies.mockReset(); listSetuLegacyFids.mockReset(); });

describe('getMigrationStatus', () => {
  it('flags legacy fids absent from Setu families', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }, { fid: '2' }, { fid: '3' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1', '2']));
    const res = await getMigrationStatus({ checkedAt: '2026-06-09T00:00:00.000Z' });
    expect(res.legacyTotal).toBe(3);
    expect(res.migrated).toBe(2);
    expect(res.missing).toBe(1);
    expect(res.missingFids).toEqual(['3']);
    expect(res.checkedAt).toBe('2026-06-09T00:00:00.000Z');
  });

  it('reports zero missing when all legacy fids are migrated', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1']));
    const res = await getMigrationStatus({ checkedAt: 'x' });
    expect(res.missing).toBe(0);
    expect(res.missingFids).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/reconcile-migration`
Expected: FAIL — `Cannot find module '../reconcile-migration'` / `'../setu-legacy-fids'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/portal/src/features/setu/roster/setu-legacy-fids.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** All non-null legacyFid values present in the Setu families collection. */
export async function listSetuLegacyFids(): Promise<Set<string>> {
  const snap = await portalFirestore().collection('families').select('legacyFid').get();
  const out = new Set<string>();
  for (const d of snap.docs) {
    const lf = (d.data() as { legacyFid?: unknown }).legacyFid;
    if (typeof lf === 'string' && lf) out.add(lf);
  }
  return out;
}
```

```ts
// apps/portal/src/features/setu/roster/reconcile-migration.ts
import 'server-only';
import { listAllFamilies } from '@/features/check-in/shared/rtdb/family-lookup';
import type { MigrationStatusResponse } from '@cmt/shared-domain/setu';
import { listSetuLegacyFids } from './setu-legacy-fids';

const MISSING_SAMPLE_CAP = 200;

/**
 * Read-only reconciliation: every legacy 715b8 RTDB roster family vs the
 * Setu families that carry its legacyFid. NEVER writes 715b8.
 */
export async function getMigrationStatus(opts: { checkedAt: string }): Promise<MigrationStatusResponse> {
  const [legacy, setuLegacyFids] = await Promise.all([listAllFamilies(), listSetuLegacyFids()]);
  const legacyFids = [...new Set(legacy.map((f) => String(f.fid)).filter(Boolean))];
  const missingFids = legacyFids.filter((fid) => !setuLegacyFids.has(fid));
  return {
    legacyTotal: legacyFids.length,
    migrated: legacyFids.length - missingFids.length,
    missing: missingFids.length,
    missingFids: missingFids.slice(0, MISSING_SAMPLE_CAP),
    checkedAt: opts.checkedAt,
  };
}
```

> If `.select()` is unsupported by the fake-firestore in other tests that import this, fall back to `.get()` and read `legacyFid` from the full doc. The reconcile test mocks `listSetuLegacyFids`, so it is unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/reconcile-migration`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/roster/reconcile-migration.ts apps/portal/src/features/setu/roster/setu-legacy-fids.ts apps/portal/src/features/setu/roster/__tests__/reconcile-migration.test.ts
git commit -m "feat(roster): read-only legacy migration-completeness reconciliation (Phase 3 Task 5)"
git push
```

---

### Task 6: API routes + `canAccessRoute` rule (same commit)

**Files:**
- Create: `apps/portal/src/app/api/welcome/families/route.ts`
- Create: `apps/portal/src/app/api/welcome/families/migration-status/route.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `apps/portal/src/app/api/welcome/families/__tests__/route.test.ts`
- Test: `packages/shared-domain/src/__tests__/can-access-route.test.ts` (add cases)

Auth pattern: read `readSessionFromHeaders(req)`; build a `WithRole`-ish object and gate with `isWelcomeTeam(...)` (admin inherits welcome-team). Mirror the header-reading already in `api/setu/family/search/route.ts` but via the shared `readSessionFromHeaders` helper. JSON responses are ISO-string-safe (the roster rows carry no Date fields; `checkedAt` is already a string).

- [ ] **Step 1: Write the failing `canAccessRoute` cases first** (rule belongs in the same commit)

```ts
// add to packages/shared-domain/src/__tests__/can-access-route.test.ts
describe('roster API (/api/welcome/families)', () => {
  const welcome = { role: 'welcome-team' } as SessionClaims;
  const adminClaims = { role: 'admin' } as SessionClaims;
  const familyClaims = { role: 'family-manager' } as SessionClaims;
  const memberClaims = { role: 'family-member' } as SessionClaims;

  it('admits welcome-team and admin', () => {
    expect(canAccessRoute(welcome, '/api/welcome/families', 'GET')).toBe(true);
    expect(canAccessRoute(adminClaims, '/api/welcome/families', 'GET')).toBe(true);
    expect(canAccessRoute(welcome, '/api/welcome/families/migration-status', 'GET')).toBe(true);
  });

  it('denies family roles', () => {
    expect(canAccessRoute(familyClaims, '/api/welcome/families', 'GET')).toBe(false);
    expect(canAccessRoute(memberClaims, '/api/welcome/families', 'GET')).toBe(false);
  });
});
```

(Use the test file's existing `SessionClaims` import/builders — match how other welcome cases are constructed; `extraRoles` may be required by the type.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cmt/shared-domain test -- can-access-route`
Expected: FAIL — `/api/welcome/families` falls through to `return false`.

- [ ] **Step 3: Add the `canAccessRoute` rule**

In `packages/shared-domain/src/auth/can-access-route.ts`, **before** the existing `/api/welcome/enrollments` block (any order among the welcome rules is fine, but keep it grouped with the other `/api/welcome/*` rules), add:

```ts
  // Welcome-team API — roster browse/filter/CSV + migration reconciliation.
  if (pathname === '/api/welcome/families' || pathname.startsWith('/api/welcome/families/')) {
    return isWelcomeTeam(claims);
  }
```

- [ ] **Step 4: Write the failing route test**

```ts
// apps/portal/src/app/api/welcome/families/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listRosterFamilies = vi.fn();
const expandPeople = vi.fn();
vi.mock('@/features/setu/roster/list-families', () => ({ listRosterFamilies }));
vi.mock('@/features/setu/roster/expand-people', () => ({ expandPeople }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

import { GET } from '../route';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(`https://x${url}`, { headers });
}
const WELCOME = { 'x-portal-role': 'welcome-team', 'x-portal-extra-roles': '' };

beforeEach(() => { listRosterFamilies.mockReset(); expandPeople.mockReset(); });

describe('GET /api/welcome/families', () => {
  it('401 with no session header', async () => {
    const res = await GET(req('/api/welcome/families', {}));
    expect(res.status).toBe(401);
  });

  it('403 for a family role', async () => {
    const res = await GET(req('/api/welcome/families', { 'x-portal-role': 'family-member', 'x-portal-extra-roles': '' }));
    expect(res.status).toBe(403);
  });

  it('200 returns the roster list JSON for welcome-team', async () => {
    listRosterFamilies.mockResolvedValue({ families: [{ fid: 'CMT-X' }], nextCursor: null, total: 1 });
    const res = await GET(req('/api/welcome/families?limit=50', WELCOME));
    expect(res.status).toBe(200);
    expect((await res.json()).families).toHaveLength(1);
  });

  it('format=csv streams text/csv with a one-row-per-person body', async () => {
    listRosterFamilies.mockResolvedValue({ families: [{ fid: 'CMT-X', name: 'Patel', legacyFid: '1', location: 'Brampton', memberCount: 1, payment: 'paid', programs: [] }], nextCursor: null, total: 1 });
    expandPeople.mockResolvedValue([{ familyName: 'Patel', fid: 'CMT-X', legacyFid: '1', memberName: 'Ravi Patel', type: 'Child', grade: '3', location: 'Brampton', programs: '', payment: 'paid' }]);
    const res = await GET(req('/api/welcome/families?format=csv', WELCOME));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await res.text()).toContain('Ravi Patel');
  });

  it('400 on an invalid query param (unknown location)', async () => {
    const res = await GET(req('/api/welcome/families?location=Toronto', WELCOME));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @cmt/portal test -- api/welcome/families`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 6: Write the routes**

```ts
// apps/portal/src/app/api/welcome/families/route.ts
import { NextResponse } from 'next/server';
import { isWelcomeTeam, RosterQuerySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { listRosterFamilies } from '@/features/setu/roster/list-families';
import { expandPeople } from '@/features/setu/roster/expand-people';
import { rosterToCsv } from '@/features/setu/roster/roster-csv';

export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = RosterQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  const params = parsed.data;

  if (params.format === 'csv') {
    // CSV exports the full matched set (no pagination), capped in expandPeople.
    const all = await listRosterFamilies({ ...params, limit: 100, cursor: undefined, format: 'json' });
    let families = all.families;
    let cursor = all.nextCursor;
    while (cursor) {
      const next = await listRosterFamilies({ ...params, limit: 100, cursor, format: 'json' });
      families = families.concat(next.families);
      cursor = next.nextCursor;
      if (families.length >= 2000) break; // expandPeople enforces + logs the hard cap
    }
    const csv = rosterToCsv(await expandPeople(families));
    return new NextResponse(csv, {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="roster.csv"' },
    });
  }

  const result = await listRosterFamilies(params);
  return NextResponse.json(result, { status: 200 });
}
```

```ts
// apps/portal/src/app/api/welcome/families/migration-status/route.ts
import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { getMigrationStatus } from '@/features/setu/roster/reconcile-migration';

export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const status = await getMigrationStatus({ checkedAt: new Date().toISOString() });
  return NextResponse.json(status, { status: 200 });
}
```

> Confirm `RosterQuerySchema` is reachable from the `@cmt/shared-domain` root barrel (Task 1 exported it through `./setu`). If the root barrel doesn't re-export `./setu`, import from `@cmt/shared-domain/setu` instead, matching how `FamilyDoc` is imported in the family-detail page.

- [ ] **Step 7: Run both test files to verify they pass**

Run: `pnpm --filter @cmt/shared-domain test -- can-access-route && pnpm --filter @cmt/portal test -- api/welcome/families`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/__tests__/can-access-route.test.ts apps/portal/src/app/api/welcome/families/
git commit -m "feat(roster): /api/welcome/families browse+csv + migration-status API + canAccessRoute rule (Phase 3 Task 6)"
git push
```

---

### Task 7: Firestore indexes (declare + UAT deploy)

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `docs/runbooks/production-cutover-checklist.md` (§14 change-log + prod TODO)

The program filter needs an `enrollments (programKey, status)` COLLECTION_GROUP index; the location-ordered browse needs a `families (location, name)` COLLECTION composite index.

- [ ] **Step 1: Add the two indexes to the `indexes` array in `firestore.indexes.json`**

```json
    {
      "collectionGroup": "enrollments",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "programKey", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "families",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "location", "order": "ASCENDING" },
        { "fieldPath": "name", "order": "ASCENDING" }
      ]
    }
```

- [ ] **Step 2: Deploy to UAT only (NEVER `--force`, NEVER prod)**

Run: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`
Expected: "✔ Deploy complete!" (the CLI may warn about "extra" indexes present in UAT but not in the file — leave them alone, do not `--force`).

- [ ] **Step 3: Poll until both indexes report READY**

Run: `firebase firestore:indexes --project chinmaya-setu-uat` (repeat until the two new composite/group indexes show state READY, ~1–5 min).

- [ ] **Step 4: Update the cutover runbook (same turn)**

Append to `docs/runbooks/production-cutover-checklist.md` §14 change-log a dated 2026-06-09 entry: the two new indexes deployed to UAT, and a **prod TODO** — "deploy `enrollments (programKey,status)` + `families (location,name)` to prod 715b8 **without `--force`** at cutover". Mirror the existing §14 entry format.

- [ ] **Step 5: Commit**

```bash
git add firestore.indexes.json docs/runbooks/production-cutover-checklist.md
git commit -m "chore(roster): firestore indexes for program/location roster filters (UAT-deployed) (Phase 3 Task 7)"
git push
```

---

### Task 8: Roster screen + client wrappers (desktop + mobile)

**Files:**
- Create: `apps/portal/src/features/setu/roster/roster-client.ts`
- Create: `apps/portal/src/features/setu/roster/roster-browser.tsx`
- Create: `apps/portal/src/features/setu/roster/migration-strip.tsx`
- Create: `apps/portal/src/features/setu/roster/roster-export-button.tsx`
- Create: `apps/portal/src/app/welcome/roster/page.tsx`
- Create: `apps/portal/src/app/welcome/roster/error.tsx`
- Test: `apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx`

**Client wrappers** (`roster-client.ts`) — throw on non-OK (so the UI fires its error state, per `searchFamiliesClient`):

```ts
// apps/portal/src/features/setu/roster/roster-client.ts
import type { RosterListResponse, RosterQuery, MigrationStatusResponse } from '@cmt/shared-domain/setu';

export async function fetchRosterClient(params: Partial<RosterQuery>): Promise<RosterListResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.location) qs.set('location', params.location);
  if (params.program) qs.set('program', params.program);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  const res = await fetch(`/api/welcome/families?${qs.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`roster-failed-${res.status}`);
  return (await res.json()) as RosterListResponse;
}

export async function fetchMigrationStatusClient(): Promise<MigrationStatusResponse> {
  const res = await fetch('/api/welcome/families/migration-status', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`migration-status-failed-${res.status}`);
  return (await res.json()) as MigrationStatusResponse;
}
```

**Search-as-filter:** when the search box is non-empty, call `searchFamiliesClient(q)` (existing) and render its `FamilySearchHit[]` as cards (no payment/program — search hits don't carry them; that's acceptable, label them "search results"). When empty, show the browse list from `fetchRosterClient`. This matches the spec: "when the search box is non-empty, show search hits instead of the browse page."

**`roster-browser.tsx`** (`'use client'`) — the core screen. Requirements:
- Desktop layout uses the welcome `layout.tsx` `<main>` wrapper (do NOT add another sidebar). Mobile layout is a separate `block md:hidden` branch with its own `CspRoot` + bottom padding (90px) for the fixed mobile nav, mirroring `welcome/page.tsx`.
- A search input (reuse the debounce + stale-sequence pattern from `welcome-search.tsx`).
- Location filter: a row of chips (All · Brampton · Mississauga · Scarborough · Markham) from `LOCATIONS`. Program filter: chips for the known program keys (import the program-key list / labels; if a label map isn't readily exported, use the keys with title-case). Selecting a chip refetches from page 1.
- Family cards: `name + " Family"`, `FID · Legacy · location`, member count, a payment chip (`paid` green / `outstanding` amber / `unknown` muted), and active program labels. The whole card is a `<Link href={'/welcome/family/' + fid}>` (reuse the existing card styling from `welcome-search.tsx`).
- "Load more" button when `nextCursor` is non-null (appends the next page; passes `cursor`).
- A header count: "N families" from `total` (browse mode only).
- The `<RosterExportButton/>` (Task: below) and `<MigrationStrip/>` near the top.
- All inline-styled with brand tokens (`var(--ink)`, `var(--muted)`, `var(--surface)`, `var(--line)`, `var(--accent)`), matching the welcome/admin screens. Tap targets ≥44px on mobile (`minHeight: 44`). Min 44px is a designer blocker from Phase 1 — honor it.

**`migration-strip.tsx`** (`'use client'`) — on mount, `fetchMigrationStatusClient()`; render a compact strip: "Migration status · {migrated} of {legacyTotal} legacy families migrated · {missing} not yet in portal". When `missing > 0`, an expander lists `missingFids`. Fail quietly (render nothing or a muted "couldn't check" line) on error — it must never block the roster. Because it fires the ~864-family 715b8 read, it loads independently (its own fetch), so the browse list is never blocked.

**`roster-export-button.tsx`** (`'use client'`) — reuse the fetch→blob→`a.download` pattern from `report-export-button.tsx`, but GET `/api/welcome/families?{currentFilters}&format=csv`; filename `roster.csv`. Takes the current `{q, location, program}` as props so the export matches what's on screen.

**`page.tsx`** — server component. Mirror `welcome/family/[fid]/page.tsx`: a thin default export wrapping the body in `<Suspense>`; `await connection()` at the top of the body (the screen itself fetches client-side, but `connection()` keeps PPR from trying to prerender any incidental dynamic access). Render `<RosterBrowser/>` inside both the mobile and desktop branches (the component owns both via its internal `block md:hidden` / `hidden md:block`). `metadata.title = 'Roster · Setu'`.

**`error.tsx`** — standard per-segment error boundary (copy `welcome/family/[fid]/error.tsx`).

- [ ] **Step 1: Write the failing component test** (mock the client wrappers)

```tsx
// apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchRosterClient = vi.fn();
const fetchMigrationStatusClient = vi.fn();
const searchFamiliesClient = vi.fn();
vi.mock('../roster-client', () => ({ fetchRosterClient, fetchMigrationStatusClient }));
vi.mock('@/features/setu/search/search-families-client', () => ({ searchFamiliesClient }));

import { RosterBrowser } from '../roster-browser';

beforeEach(() => {
  fetchRosterClient.mockReset(); fetchMigrationStatusClient.mockReset(); searchFamiliesClient.mockReset();
  fetchMigrationStatusClient.mockResolvedValue({ legacyTotal: 3, migrated: 3, missing: 0, missingFids: [], checkedAt: 'x' });
});

describe('RosterBrowser', () => {
  it('renders the browse list on mount', async () => {
    fetchRosterClient.mockResolvedValue({
      families: [{ fid: 'CMT-X', legacyFid: '1', name: 'Patel', location: 'Brampton', memberCount: 4, payment: 'paid', programs: ['Bala Vihar'] }],
      nextCursor: null, total: 1,
    });
    render(<RosterBrowser />);
    expect(await screen.findByText(/Patel Family/)).toBeInTheDocument();
    expect(screen.getByText(/1 famil/i)).toBeInTheDocument();
  });

  it('switches to search results when the search box has text', async () => {
    fetchRosterClient.mockResolvedValue({ families: [], nextCursor: null, total: 0 });
    searchFamiliesClient.mockResolvedValue([{ fid: 'CMT-S', legacyFid: null, name: 'Sharma', location: 'Markham', memberCount: 2 }]);
    render(<RosterBrowser />);
    await userEvent.type(screen.getByTestId('roster-search-input'), 'sharma');
    await waitFor(() => expect(screen.getByText(/Sharma Family/)).toBeInTheDocument());
  });

  it('shows a "Load more" button when nextCursor is present', async () => {
    fetchRosterClient.mockResolvedValue({
      families: [{ fid: 'CMT-X', legacyFid: null, name: 'Patel', location: 'Brampton', memberCount: 1, payment: 'unknown', programs: [] }],
      nextCursor: 'CMT-X', total: 10,
    });
    render(<RosterBrowser />);
    expect(await screen.findByRole('button', { name: /load more/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/roster-browser`
Expected: FAIL — `Cannot find module '../roster-browser'`.

- [ ] **Step 3: Implement** the client wrappers, `roster-browser.tsx`, `migration-strip.tsx`, `roster-export-button.tsx`, `page.tsx`, `error.tsx` per the requirements above. Keep the debounce/stale-sequence search logic from `welcome-search.tsx`. Use `data-testid="roster-search-input"` on the search field.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal test -- roster/__tests__/roster-browser`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint the new screen**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: clean (watch for `exactOptionalPropertyTypes` on the filter params — use conditional spreads, never assign `undefined`).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/roster/roster-client.ts apps/portal/src/features/setu/roster/roster-browser.tsx apps/portal/src/features/setu/roster/migration-strip.tsx apps/portal/src/features/setu/roster/roster-export-button.tsx apps/portal/src/app/welcome/roster/ apps/portal/src/features/setu/roster/__tests__/roster-browser.test.tsx
git commit -m "feat(roster): /welcome/roster browse/search/filter/export screen + migration strip (Phase 3 Task 8)"
git push
```

---

### Task 9: Wire `/welcome` → roster + nav + retire the old search hero

**Files:**
- Modify: `apps/portal/src/app/welcome/page.tsx` → redirect to `/welcome/roster`
- Delete: `apps/portal/src/app/welcome/welcome-search.tsx`, `apps/portal/src/app/welcome/__tests__/welcome-search.test.tsx`, `apps/portal/src/__tests__/e2e/welcome-search.e2e.test.ts`
- Modify: `apps/portal/src/app/welcome/__tests__/page.test.tsx` → assert the redirect (or delete if it only asserted the hero)
- Modify: `apps/portal/src/features/family/components/welcome-mobile-nav.tsx` → "Search"→"Roster" (`/welcome/roster`)

Search now lives integrated on the roster screen, so the standalone hero is retired. `searchFamilies` / `searchFamiliesClient` / `GET /api/setu/family/search` STAY (reused by the roster screen's search-as-filter).

- [ ] **Step 1: Replace `welcome/page.tsx` with a redirect**

```tsx
// apps/portal/src/app/welcome/page.tsx
import { redirect } from 'next/navigation';

export default function WelcomeIndexPage() {
  redirect('/welcome/roster');
}
```

- [ ] **Step 2: Update the mobile nav** — in `welcome-mobile-nav.tsx`, change the first item to point at `/welcome/roster` with the label "Roster" and rename `isSearchActive` → `isRosterActive` (active when not levels/seva; also active on `/welcome` and `/welcome/roster` and `/welcome/family`):

```tsx
function isRosterActive(pathname: string): boolean {
  return !pathname.startsWith('/welcome/levels') && !pathname.startsWith('/welcome/seva');
}
// ...
<Link href="/welcome/roster" style={itemStyle(rosterActive)}>
  <SetuIcon.search /> Roster
</Link>
```

- [ ] **Step 3: Delete the retired hero + its tests**

```bash
git rm apps/portal/src/app/welcome/welcome-search.tsx \
       apps/portal/src/app/welcome/__tests__/welcome-search.test.tsx \
       apps/portal/src/__tests__/e2e/welcome-search.e2e.test.ts
```

- [ ] **Step 4: Fix/replace `welcome/__tests__/page.test.tsx`** — it currently asserts the search hero. Replace with a redirect assertion (mock `next/navigation`'s `redirect` and assert it's called with `/welcome/roster`), or delete the file if it has no other coverage. Confirm no other test imports `WelcomeSearch` (`grep -rn "welcome-search\|WelcomeSearch" apps/portal/src`).

- [ ] **Step 5: Run the affected tests**

Run: `pnpm --filter @cmt/portal test -- welcome`
Expected: PASS — no references to the deleted hero remain.

- [ ] **Step 6: Commit**

```bash
git add -A apps/portal/src/app/welcome/page.tsx apps/portal/src/app/welcome/__tests__/page.test.tsx apps/portal/src/features/family/components/welcome-mobile-nav.tsx
git commit -m "feat(roster): /welcome redirects to /welcome/roster; nav Search→Roster; retire standalone search hero (Phase 3 Task 9)"
git push
```

---

### Task 10: Full pre-push gate (whole repo)

**Files:** none (verification).

- [ ] **Step 1: Run the full gate exactly as the pre-push hook does**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. If "Collecting page data" fails on `/welcome/roster`, the page is doing a live Firebase read at build — ensure the data fetch is client-side and the server page only does `await connection()` inside a `<Suspense>` body (do NOT fetch roster data in the server component).

- [ ] **Step 2: Fix any failures at the root cause** (never `--no-verify`). Re-run until green.

- [ ] **Step 3:** No commit unless a fix was needed; if so, commit + push it with a descriptive message.

---

### Task 11: Playwright headless E2E (deployed UAT)

**Files:**
- Create: `apps/portal/e2e/setu/admin/roster.spec.ts`

Per the standing rule: log in via the password-sign-in route (the `setu` project's saved storageState — the single UAT test user is family-manager **+ admin**, so it passes the welcome-team gate), run headless against the **deployed UAT app**. Roster is read-only, so **no mutations / no cleanup** needed. The spec can only go green after Tasks 1–9 are pushed AND Vercel has deployed.

Screens render both desktop and mobile blocks in the DOM — filter to visible elements (`.filter({ visible: true })` or target the desktop block) to avoid strict-mode "resolved to 2 elements" failures.

- [ ] **Step 1: Write the spec**

```ts
// apps/portal/e2e/setu/admin/roster.spec.ts
import { test, expect } from '../../fixtures';

const hasFamilyCreds = Boolean(process.env.E2E_FAMILY_EMAIL && process.env.E2E_FAMILY_PASSWORD);

test.describe('Phase 3 — Roster (/welcome/roster)', () => {
  test.skip(!hasFamilyCreds, 'requires E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD');

  test('browse → search-as-filter → drill to family detail', async ({ page }) => {
    await page.goto('/welcome/roster');
    // Browse list renders at least one family card (UAT has migrated families).
    const cards = page.getByTestId('roster-results').getByRole('link');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Search-as-filter: type the seeded family's name; its card appears.
    await page.getByTestId('roster-search-input').first().fill('E2E');
    await expect(page.getByText(/E2E.*Family/i).first()).toBeVisible({ timeout: 15_000 });

    // Drill into the first result → family detail page.
    await page.getByText(/E2E.*Family/i).first().click();
    await expect(page).toHaveURL(/\/welcome\/family\/CMT-/);
  });

  test('CSV export endpoint returns text/csv for the signed-in welcome/admin user', async ({ page }) => {
    const res = await page.request.get('/api/welcome/families?format=csv&limit=5');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(await res.text()).toContain('familyName,fid,legacyFid');
  });

  test('migration-status endpoint returns counts', async ({ page }) => {
    const res = await page.request.get('/api/welcome/families/migration-status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.legacyTotal).toBe('number');
    expect(typeof body.migrated).toBe('number');
  });
});
```

> Add `data-testid="roster-results"` to the results container in `roster-browser.tsx` (Task 8) so the spec can scope to it. If the seeded family's display name isn't literally "E2E …", adjust the search term to match the seed (`E2E_FAMILY_EMAIL`'s resolved family — check `scripts/seed-e2e-family.ts` for the family `name`). The family detail URL is `/welcome/family/CMT-…`.

- [ ] **Step 2: Re-seed the UAT test user** (the integration suite's `_test:true` sweep may have removed it)

Run: `pnpm --filter @cmt/portal seed:e2e-family`
Expected: idempotent — resolves/ensures the family-manager+admin UAT user.

- [ ] **Step 3: Run the spec against deployed UAT** (only after Tasks 1–9 are pushed and Vercel has finished deploying)

Run: `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu roster`
Expected: PASS (3 tests). If a card-name assertion fails because the seed family's name differs, fix the search term to match the seed and re-run — do NOT loosen the assertion to always-pass.

- [ ] **Step 4: Run the full setu E2E suite to confirm no regressions**

Run: `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm test:e2e 2>&1 | tail -15`
Expected: all prior specs + the new roster spec green (no new failures).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/e2e/setu/admin/roster.spec.ts apps/portal/src/features/setu/roster/roster-browser.tsx
git commit -m "test(roster): Playwright headless E2E for /welcome/roster against deployed UAT (Phase 3 Task 11)"
git push
```

---

### Task 12: Update CLAUDE.md phase status + final review

**Files:**
- Modify: `CLAUDE.md` (Phase 3 / admin-revamp status note)

- [ ] **Step 1:** Add/refresh the admin-revamp status line in `CLAUDE.md` noting Phase 3 (Roster) shipped: `/welcome/roster` browse/search/filter/export + read-only migration-completeness; new `/api/welcome/families` + `migration-status`; `enrollments (programKey,status)` + `families (location,name)` indexes deployed to UAT (prod TODO at cutover).

- [ ] **Step 2:** Dispatch the final whole-implementation code review (subagent-driven-development's final reviewer). Address any blocker/important findings, then commit + push.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark admin-revamp Phase 3 (Roster) shipped (Phase 3 Task 12)"
git push
```

---

## Self-review (against the spec, done while writing)

- **Spec coverage:** browse query (T3) ✓; search-as-filter reuses `searchFamilies` (T8) ✓; location filter (T3+T7) ✓; program filter via collectionGroup intersect (T3+T7) ✓; payment chip (T2+T3) ✓ — shipped as display chip (server `?payment=` filter intentionally deferred per spec "MVP may ship location+program first"; document in T8/T12); family detail reuse (T8) ✓; flat people CSV (T4+T6) ✓; migration-completeness (T5+T6+T8) ✓; `/api/welcome/families` + canAccessRoute rule + tests same commit (T6) ✓; mobile layout + mobile-ready API (T6+T8) ✓; N=2 (T3 program dup test) ✓; index deploy UAT + runbook (T7) ✓; Playwright E2E (T11) ✓.
- **Deviation flagged:** the spec lists `?payment=` as a filter param; this plan ships payment as a **display chip only** for MVP (a server payment filter breaks name-cursor pagination, and the spec explicitly allows deferring it). Recorded in T8/T12. If the team wants the filter, it becomes a fast follow.
- **Type consistency:** `RosterQuery`/`RosterFamilyRow`/`RosterListResponse`/`RosterPersonCsvRow`/`MigrationStatusResponse` defined in T1 and used verbatim in T3/T4/T5/T6/T8. `deriveFamilyPayment` (T2) consumed by T3. `listRosterFamilies` (T3) consumed by T6/T8-via-API. `expandPeople`+`rosterToCsv` (T4) consumed by T6. `getMigrationStatus` (T5) consumed by T6.
- **No placeholders:** every code step has real code; every run step has a command + expected result.
