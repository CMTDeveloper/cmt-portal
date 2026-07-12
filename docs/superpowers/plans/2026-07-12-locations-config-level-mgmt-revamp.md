# Admin-managed Locations + Level Management Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the set of centre locations admin-managed config (default Brampton + Scarborough, admins can add/remove-unused/reorder real centres with no deploy) and reshape `/admin/levels` into the master-detail layout from the 2026-07-12 mockup (always-one-selected location filter, stat cards, right-hand teacher panel with many teachers per level and one optional Lead).

**Architecture:** Locations follow the existing `app_config` pattern (`app_config/locations`, exactly like `app_config/volunteering_skills`). Shared-domain location fields relax from `z.enum(LOCATIONS)` to `z.string().min(1)`; membership ("is this a real centre?") is enforced at write time against the dynamic list, mirroring how `programKey` evolved. Location stays a plain display string (name = key) so there is zero data migration. The levels UI is reshaped in `features/admin/levels/`; server loads in `app/admin/levels/page.tsx` are unchanged except to carry a new `leadTeacherRef` field.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Firebase Admin (Firestore `portalFirestore()` = chinmaya-setu-uat), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-12-locations-config-level-mgmt-revamp-design.md`
**Anchors digest (read excerpts):** `.superpowers/sdd/locations-level-mgmt-anchors.md`

## Global Constraints

- **UAT only** — all DB ops target `chinmaya-setu-uat`; never touch prod `715b8`; never `--force` an index deploy.
- **Never** bypass the pre-push hook with `--no-verify`; fix the code, not the hook.
- **Never** use the em dash character; use a plain hyphen `-`.
- **`exactOptionalPropertyTypes` is enabled** — never assign `undefined` to an optional; omit the key or use `null`.
- **Doc-schema location fields relax to `z.string().min(1)`** (read-validation discipline — doc schemas validate on READ; never over-tighten). Enforce membership/required-ness at write routes + forms.
- **`leadTeacherRef` on a doc schema is `z.string().nullable().optional()`** — never `.min(1)` required on a read-validated doc field.
- **A public `/api/setu/*` route needs BOTH** an entry in `public-routes.ts` AND a `canAccessRoute` clause.
- **Any `/api/setu/**` request/response shape change → append a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md`.**
- **Bulk `collectionGroup` reads**, never per-family fan-out.
- **Never declare function components inside components** — hoist render helpers or call as plain functions (`teacherCell(l)`).
- **Every user-facing route gets a deployed-UAT Playwright E2E** with a realistic, multi-instance, active-state fixture; password sign-in; run vs `https://cmt-setu.vercel.app`; self-cleaning.
- **Run the FULL vitest suite** (`pnpm --filter @cmt/portal test`) before pushing shared route/schema changes — integration tests live in separate dirs and targeted globs miss them.
- Commit author is the repo-local `CMT Developer <developer@chinmayatoronto.org>`; do NOT add any agent co-author.
- Keep `docs/runbooks/production-cutover-checklist.md` §14 current for any UAT DB op.

**Verification commands:**
- Typecheck: `pnpm --filter @cmt/portal typecheck`
- Lint: `pnpm --filter @cmt/portal lint`
- Unit (targeted): `pnpm --filter @cmt/portal exec vitest run <path>`
- Unit (full, before push): `pnpm --filter @cmt/portal test`
- Shared-domain tests: `pnpm --filter @cmt/shared-domain test`
- Deployed E2E: `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu <spec>`

---

## File Structure

**Slice 1 — Foundation (locations as config):**
- Create `apps/portal/src/lib/locations.ts` — config lib (`DEFAULT_LOCATIONS`, `getLocationOptions`, `setLocationOptions`).
- Create `apps/portal/src/lib/__tests__/locations.test.ts`.
- Modify 7 shared-domain schema files — relax `z.enum(LOCATIONS)` → `z.string().min(1)`; reduce `LOCATIONS` const + `type Location = string`.
- Create `apps/portal/src/app/api/admin/locations/route.ts` (GET + PUT with referential guard) + its `__tests__/route.test.ts`.
- Create `apps/portal/src/features/setu/locations/referenced-locations.ts` — helper counting references for the guard + its test.
- Create `apps/portal/src/app/admin/locations/page.tsx` + `apps/portal/src/features/admin/locations/locations-editor.tsx`.
- Modify admin nav: `app/admin/page.tsx`, `features/admin/components/admin-sidebar.tsx`, `features/admin/components/admin-mobile-nav.tsx`.
- Create `apps/portal/src/app/api/setu/locations/route.ts` (public GET) + its test.
- Modify `packages/shared-domain/src/auth/public-routes.ts` + `packages/shared-domain/src/auth/can-access-route.ts`.
- Modify write/validators: `app/api/setu/register/route.ts`, `app/api/admin/calendar/route.ts`, `app/api/admin/calendar/weekly/route.ts`, `app/api/setu/calendar/route.ts`.
- Modify UI pickers to read the dynamic list: `app/register/family/page.tsx`, `app/admin/calendar/page.tsx`, `features/admin/programs/{program-form,offerings-panel,programs-table}.tsx`, `features/setu/roster/roster-browser.tsx`.
- Modify `apps/portal/docs/MOBILE_API_CHANGELOG.md`, `docs/runbooks/production-cutover-checklist.md`.

**Slice 2 — Level Management redesign:**
- Modify `packages/shared-domain/src/setu/schemas/level.ts` (add `leadTeacherRef`).
- Modify `app/api/admin/levels/[levelId]/route.ts` (PATCH sets/validates lead), `app/api/admin/levels/[levelId]/teachers/route.ts` (DELETE clears lead on removal).
- Modify `app/admin/levels/page.tsx` (carry `leadTeacherRef` through the field mapper).
- Modify `features/admin/levels/assign-teacher-client.ts` (add `setLevelLeadTeacherClient`).
- Create `features/admin/levels/level-detail-panel.tsx` (right panel).
- Rewrite `features/admin/levels/levels-management.tsx` + refactor `features/admin/levels/levels-table.tsx` into a master list + selection.
- Create `apps/portal/e2e/setu/admin/locations.spec.ts` + `apps/portal/e2e/setu/admin/level-management-redesign.spec.ts`.

---

## SLICE 1 — Locations as admin-managed config

### Task 1: Locations config lib

**Files:**
- Create: `apps/portal/src/lib/locations.ts`
- Test: `apps/portal/src/lib/__tests__/locations.test.ts`

**Interfaces:**
- Consumes: `LOCATIONS` from `@cmt/shared-domain` (still the 4-value const at this point; Task 2 reduces it — either order compiles because `[...LOCATIONS]` just spreads whatever is there).
- Produces: `DEFAULT_LOCATIONS: readonly string[]`, `getLocationOptions(): Promise<string[]>`, `setLocationOptions(options: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test** (clone `apps/portal/src/lib/__tests__/volunteering-skills.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { getLocationOptions, setLocationOptions, DEFAULT_LOCATIONS } from '../locations';

beforeEach(() => { vi.clearAllMocks(); });

describe('getLocationOptions', () => {
  it('returns the default seed when the config doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getLocationOptions()).toEqual([...DEFAULT_LOCATIONS]);
  });
  it('returns the stored options when the doc exists', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: ['Brampton', 'Oakville'] }) });
    expect(await getLocationOptions()).toEqual(['Brampton', 'Oakville']);
  });
  it('falls back to defaults when options is not an array', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: 'nope' }) });
    expect(await getLocationOptions()).toEqual([...DEFAULT_LOCATIONS]);
  });
  it('drops non-string entries defensively', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: ['Brampton', 7, null, 'Scarborough'] }) });
    expect(await getLocationOptions()).toEqual(['Brampton', 'Scarborough']);
  });
});

describe('DEFAULT_LOCATIONS', () => {
  it('is exactly Brampton then Scarborough', () => {
    expect([...DEFAULT_LOCATIONS]).toEqual(['Brampton', 'Scarborough']);
  });
});

describe('setLocationOptions', () => {
  it('writes the options array with a server timestamp', async () => {
    mockSet.mockResolvedValue(undefined);
    await setLocationOptions(['Brampton', 'Scarborough']);
    expect(mockSet).toHaveBeenCalledWith({ options: ['Brampton', 'Scarborough'], updatedAt: 'SERVER_TS' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/lib/__tests__/locations.test.ts`
Expected: FAIL — `Cannot find module '../locations'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/portal/src/lib/locations.ts
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

/**
 * Default centre locations, seeded into every location picker until an admin
 * saves their own list at /admin/locations. Once the config doc is written the
 * stored options take precedence. Location is a plain display string (the name
 * IS the key), so there is no slug and no migration of stored `location` fields.
 */
export const DEFAULT_LOCATIONS: readonly string[] = ['Brampton', 'Scarborough'];

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'locations';

/**
 * Reads the admin-managed centre locations from PORTAL_FIREBASE. Falls back to
 * {@link DEFAULT_LOCATIONS} when the config doc has never been written (no lazy
 * write, so the read path needs no write permission). The writer enforces a
 * non-empty list, so a present doc always has at least one centre.
 */
export async function getLocationOptions(): Promise<string[]> {
  const snap = await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return [...DEFAULT_LOCATIONS];
  const options = snap.data()?.['options'];
  if (!Array.isArray(options)) return [...DEFAULT_LOCATIONS];
  return options.filter((o): o is string => typeof o === 'string');
}

/**
 * Overwrites the locations config doc. The caller (the admin PUT route) trims,
 * dedupes, validates non-empty, and runs the referential-safety guard before
 * calling.
 */
export async function setLocationOptions(options: string[]): Promise<void> {
  await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set({
    options,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/lib/__tests__/locations.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/locations.ts apps/portal/src/lib/__tests__/locations.test.ts
git commit -m "feat(locations): add app_config-backed locations config lib"
```

---

### Task 2: Relax location enums in shared-domain schemas

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/offering.ts:12-13,52,116`
- Modify: `packages/shared-domain/src/setu/schemas/enrollment.ts:20,59`
- Modify: `packages/shared-domain/src/setu/schemas/level.ts:23,51`
- Modify: `packages/shared-domain/src/setu/schemas/program.ts:36,53`
- Modify: `packages/shared-domain/src/setu/schemas/class-calendar.ts:31,61,102,111`
- Modify: `packages/shared-domain/src/setu/roster.ts:40`
- Modify: `packages/shared-domain/src/setu/schemas/family.ts:55`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/family.test.ts` (+ any schema test asserting the enum)

**Interfaces:**
- Produces: `LOCATIONS = ['Brampton', 'Scarborough'] as const` (default seed, no longer the closed universe); `type Location = string`. All the above `location` fields become `z.string().min(1)` (preserving `.nullable()` / `z.array(...)` wrappers).

- [ ] **Step 1: Write/adjust the failing test** — prove a non-default centre now validates. Add to `packages/shared-domain/src/setu/schemas/__tests__/family.test.ts`:

```ts
it('accepts an admin-added centre not in the default set (location is dynamic)', () => {
  const base = {
    fid: 'CMT-X', legacyFid: null, name: 'Test', location: 'Oakville',
    createdAt: new Date(), managers: ['u1'], searchKeys: [],
  };
  expect(FamilyDocSchema.parse(base).location).toBe('Oakville');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/family.test.ts`
Expected: FAIL — `Invalid enum value. Expected 'Brampton' | 'Mississauga' | ...` for `'Oakville'`.

- [ ] **Step 3: Make the changes**

In `offering.ts`:
```ts
// L12-13
export const LOCATIONS = ['Brampton', 'Scarborough'] as const; // default seed; admin-managed list is the source of truth at runtime
export type Location = string;
// L52 and L116
  location: z.string().min(1).nullable(),
```
In `enrollment.ts`:
```ts
// L20
  location: z.string().min(1).nullable(),
// L59
  location: z.string().min(1),
```
In `level.ts`:
```ts
// L23
  location: z.string().min(1).nullable(),
// L51
  location: z.string().min(1),
```
In `program.ts`:
```ts
// L36
  locations: z.array(z.string().min(1)), // [] = location-less
// L53
  locations: z.array(z.string().min(1)).default([]),
```
In `class-calendar.ts` (L31, 61, 102, 111): replace each `z.enum(LOCATIONS)` with `z.string().min(1)`, keeping the existing `.nullable()` on L31.
In `roster.ts`:
```ts
// L40
  location: z.string().min(1).optional(),
```
Remove the now-unused `LOCATIONS` import from `roster.ts:2` if `LOCATIONS` is no longer referenced there (keep `programKeySchema`). Leave imports of `LOCATIONS` in `enrollment.ts`/`level.ts`/`program.ts`/`class-calendar.ts` only if still referenced; otherwise remove them to satisfy lint.
In `family.ts`:
```ts
// L55
  location: z.string().min(1),
```

- [ ] **Step 4: Run the shared-domain suite**

Run: `pnpm --filter @cmt/shared-domain test`
Expected: PASS. Fix any test that hardcoded the 4-value enum expectation (e.g. an assertion that `'Oakville'` is rejected) — update it to reflect the dynamic string field. Do NOT weaken assertions that check `.min(1)` rejects an empty string.

- [ ] **Step 5: Typecheck the portal** (the `Location` widening can surface literal-typed assignments)

Run: `pnpm --filter @cmt/portal typecheck`
Expected: PASS. If a `.ts` file assigned a 4-value literal to `Location`, it still compiles (widening to `string`). Fix any place that did an exhaustive switch over `LOCATIONS`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain/src/setu
git commit -m "refactor(locations): relax location schema fields from enum to string"
```

---

### Task 3: Referenced-locations guard helper

**Files:**
- Create: `apps/portal/src/features/setu/locations/referenced-locations.ts`
- Test: `apps/portal/src/features/setu/locations/__tests__/referenced-locations.test.ts`

**Interfaces:**
- Produces: `async function countLocationReferences(location: string): Promise<number>` — total docs across `families`, `offerings`, `levels`, `enrollments` (collectionGroup) whose `location === location`. Uses `.count()` aggregation so it never streams docs. `enrollments` is a collectionGroup (enrollments live under families); the others are top-level collections.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const counts: Record<string, number> = {};
function coll(name: string) {
  return {
    where: (_f: string, _op: string, val: string) => ({
      count: () => ({ get: async () => ({ data: () => ({ count: counts[`${name}:${val}`] ?? 0 }) }) }),
    }),
  };
}
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: (n: string) => coll(n),
    collectionGroup: (n: string) => coll(n),
  })),
}));

import { countLocationReferences } from '../referenced-locations';

beforeEach(() => { for (const k of Object.keys(counts)) delete counts[k]; });

it('returns 0 when nothing references the location', async () => {
  expect(await countLocationReferences('Oakville')).toBe(0);
});
it('sums references across families, offerings, levels, enrollments', async () => {
  counts['families:Brampton'] = 714;
  counts['offerings:Brampton'] = 1;
  counts['levels:Brampton'] = 8;
  counts['enrollments:Brampton'] = 500;
  expect(await countLocationReferences('Brampton')).toBe(714 + 1 + 8 + 500);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/locations/__tests__/referenced-locations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/portal/src/features/setu/locations/referenced-locations.ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * Counts how many stored docs still reference a centre location, across every
 * collection that denormalizes `location`. Used by the admin locations editor
 * to refuse removing a centre that families/offerings/levels/enrollments still
 * point at (the name is the key, so a removed centre would orphan them).
 *
 * Uses .count() aggregation (no doc streaming). families/offerings/levels are
 * top-level; enrollments live under families, so it's a collectionGroup query.
 * All are single-field equality => auto-indexed, no composite index needed.
 */
export async function countLocationReferences(location: string): Promise<number> {
  const db = portalFirestore();
  const [fam, off, lvl, enr] = await Promise.all([
    db.collection('families').where('location', '==', location).count().get(),
    db.collection('offerings').where('location', '==', location).count().get(),
    db.collection('levels').where('location', '==', location).count().get(),
    db.collectionGroup('enrollments').where('location', '==', location).count().get(),
  ]);
  return fam.data().count + off.data().count + lvl.data().count + enr.data().count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/locations/__tests__/referenced-locations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/locations
git commit -m "feat(locations): add referenced-locations count helper for the remove guard"
```

---

### Task 4: Admin `GET`/`PUT /api/admin/locations` route

**Files:**
- Create: `apps/portal/src/app/api/admin/locations/route.ts`
- Test: `apps/portal/src/app/api/admin/locations/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getLocationOptions`, `setLocationOptions` (Task 1); `countLocationReferences` (Task 3); `isAdmin` from `@cmt/shared-domain`; `readSessionFromHeaders` from `@/lib/auth/headers`.
- Produces: `GET` → `{ options }` (admin-only); `PUT` → `{ options }` on success, `{ error: 'location-in-use', location, count }` (409) when a removed centre is still referenced, `{ error: 'empty-list' }` (400) when the resulting list is empty. No new `canAccessRoute` rule needed — `/api/admin/*` is already admin-only (can-access-route.ts L60).

- [ ] **Step 1: Write the failing test** (clone the volunteering-skills route test; `x-portal-role` header drives the session role)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/locations', () => ({
  getLocationOptions: vi.fn(),
  setLocationOptions: vi.fn(),
}));
vi.mock('@/features/setu/locations/referenced-locations', () => ({
  countLocationReferences: vi.fn(),
}));

import { GET, PUT } from '../route';
import { getLocationOptions, setLocationOptions } from '@/lib/locations';
import { countLocationReferences } from '@/features/setu/locations/referenced-locations';

function req(method: string, body?: unknown, role: string | null = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  return new Request('http://localhost/api/admin/locations', {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLocationOptions).mockResolvedValue(['Brampton', 'Scarborough']);
  vi.mocked(setLocationOptions).mockResolvedValue(undefined);
  vi.mocked(countLocationReferences).mockResolvedValue(0);
});

describe('GET /api/admin/locations', () => {
  it('401 without a session', async () => expect((await GET(req('GET', undefined, null))).status).toBe(401));
  it('403 for a non-admin', async () => expect((await GET(req('GET', undefined, 'family-manager'))).status).toBe(403));
  it('200 with options for an admin', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).options).toEqual(['Brampton', 'Scarborough']);
  });
});

describe('PUT /api/admin/locations', () => {
  it('403 for a non-admin and does not write', async () => {
    const res = await PUT(req('PUT', { options: ['Brampton'] }, 'family-manager'));
    expect(res.status).toBe(403);
    expect(setLocationOptions).not.toHaveBeenCalled();
  });
  it('400 when the resulting list is empty', async () => {
    const res = await PUT(req('PUT', { options: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'empty-list' });
    expect(setLocationOptions).not.toHaveBeenCalled();
  });
  it('400 when an option is blank after trimming', async () => {
    expect((await PUT(req('PUT', { options: ['   '] }))).status).toBe(400);
  });
  it('adds a new centre and trims/dedupes (case-insensitive)', async () => {
    const res = await PUT(req('PUT', { options: ['  Brampton ', 'brampton', 'Scarborough', 'Oakville'] }));
    expect(res.status).toBe(200);
    expect(setLocationOptions).toHaveBeenCalledWith(['Brampton', 'Scarborough', 'Oakville']);
  });
  it('removes an unused centre', async () => {
    // current = [Brampton, Scarborough]; new drops Scarborough; Scarborough unused
    vi.mocked(countLocationReferences).mockResolvedValue(0);
    const res = await PUT(req('PUT', { options: ['Brampton'] }));
    expect(res.status).toBe(200);
    expect(setLocationOptions).toHaveBeenCalledWith(['Brampton']);
  });
  it('409 refusing to remove a referenced centre', async () => {
    vi.mocked(countLocationReferences).mockResolvedValue(714); // Scarborough referenced
    const res = await PUT(req('PUT', { options: ['Brampton'] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'location-in-use', location: 'Scarborough', count: 714 });
    expect(setLocationOptions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/admin/locations/__tests__/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/portal/src/app/api/admin/locations/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getLocationOptions, setLocationOptions } from '@/lib/locations';
import { countLocationReferences } from '@/features/setu/locations/referenced-locations';

const PutSchema = z.object({
  options: z.array(z.string().trim().min(1).max(60)).max(30),
});

/** GET /api/admin/locations - current centre list for the admin editor. */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  return NextResponse.json({ options: await getLocationOptions() });
}

/** PUT /api/admin/locations - replace the centre list (admin only). */
export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // Dedupe case-insensitively, keeping the first spelling of each centre.
  const seen = new Set<string>();
  const options: string[] = [];
  for (const opt of parsed.data.options) {
    const key = opt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(opt);
  }
  if (options.length === 0) {
    return NextResponse.json({ error: 'empty-list' }, { status: 400 });
  }

  // Referential-safety guard: any centre present now but absent from the new
  // list must be unreferenced (the name is the denormalized key).
  const current = await getLocationOptions();
  const nextLower = new Set(options.map((o) => o.toLowerCase()));
  const removed = current.filter((c) => !nextLower.has(c.toLowerCase()));
  for (const location of removed) {
    const count = await countLocationReferences(location);
    if (count > 0) {
      return NextResponse.json({ error: 'location-in-use', location, count }, { status: 409 });
    }
  }

  await setLocationOptions(options);
  return NextResponse.json({ options });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/admin/locations/__tests__/route.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/admin/locations
git commit -m "feat(locations): admin GET/PUT /api/admin/locations with remove guard"
```

---

### Task 5: `/admin/locations` editor page + client + admin nav

**Files:**
- Create: `apps/portal/src/app/admin/locations/page.tsx`
- Create: `apps/portal/src/features/admin/locations/locations-editor.tsx`
- Modify: `apps/portal/src/app/admin/page.tsx` (dashboard tile)
- Modify: `apps/portal/src/features/admin/components/admin-sidebar.tsx` (nav item + `deriveAdminActive`)
- Modify: `apps/portal/src/features/admin/components/admin-mobile-nav.tsx` (More sheet item)

**Interfaces:**
- Consumes: `getLocationOptions` (Task 1); `PUT /api/admin/locations` (Task 4).
- Produces: the `/admin/locations` route. Page is admin-only via `canAccessRoute` L35 (`/admin/*`).

- [ ] **Step 1: Build the page** (server component, mirrors `admin/volunteering-skills/page.tsx`)

```tsx
// apps/portal/src/app/admin/locations/page.tsx
import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { getLocationOptions } from '@/lib/locations';
import { LocationsEditor } from '@/features/admin/locations/locations-editor';

export const metadata = { title: 'Locations' };

export default async function AdminLocationsPage() {
  await connection();
  const options = await getLocationOptions();
  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>Admin</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 4 }}>Locations</h1>
        <p style={{ color: 'var(--muted)', marginTop: 8, maxWidth: 560 }}>
          The centres families choose from at registration, and that programs, levels, and the class calendar are organized by.
          A centre can be removed only once no family, offering, level, or enrollment references it.
        </p>
      </header>
      <div className="card" style={{ padding: 'clamp(14px, 4vw, 22px)', maxWidth: 640 }}>
        <LocationsEditor initialOptions={options} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Build the client editor** — clone `features/admin/volunteering-skills/skills-editor.tsx` (read it first for the exact list/add/remove/reorder markup and toast usage). Key differences: PUT to `/api/admin/locations`; surface the `location-in-use` 409 as a specific toast.

```tsx
// apps/portal/src/features/admin/locations/locations-editor.tsx
'use client';
import { useState } from 'react';
import { toast } from '@cmt/ui';

export function LocationsEditor({ initialOptions }: { initialOptions: string[] }) {
  const [options, setOptions] = useState<string[]>(initialOptions);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (options.some((o) => o.toLowerCase() === v.toLowerCase())) {
      toast.error(`${v} is already a centre.`);
      return;
    }
    setOptions((p) => [...p, v]);
    setDraft('');
  }
  function remove(i: number) { setOptions((p) => p.filter((_, idx) => idx !== i)); }
  function move(i: number, dir: -1 | 1) {
    setOptions((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/locations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options }),
      });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        toast.error(`${j.location} still has ${j.count} record(s) - reassign them before removing it.`);
        return;
      }
      if (!res.ok) { toast.error('Save failed - please try again.'); return; }
      const j = await res.json();
      setOptions(j.options as string[]);
      toast.success('Locations saved.');
    } catch {
      toast.error('Network error - please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Render: an ordered list of `options` with up/down/remove controls, an
  // add-row (input bound to `draft` + Add button), and a Save button.
  // Mirror the exact markup/classes from skills-editor.tsx.
  return (/* see skills-editor.tsx for the list + add-row + Save markup */ null);
}
```

Note: fill the JSX by mirroring `skills-editor.tsx` markup (list rows + add input + Save button), swapping the wording to "centre"/"location". Keep the reorder controls (locations are ordered; order drives the segmented filter in Slice 2).

- [ ] **Step 3: Wire the three nav surfaces**

In `app/admin/page.tsx`, inside the "Bala Vihar" group `tiles` array (after the Volunteering skills tile):
```tsx
{ href: '/admin/locations', title: 'Locations', icon: 'home', tone: 'primary', sub: 'Manage the centre locations families choose from and programs are organized by.' },
```
(Confirm `'home'` is a valid `keyof typeof SetuIcon`; if not, use an existing valid icon such as `'check'`.)

In `features/admin/components/admin-sidebar.tsx`, add to the "Bala Vihar" `items`:
```tsx
{ label: 'Locations', href: '/admin/locations' },
```
and in `deriveAdminActive` add (mirroring the volunteering-skills line):
```tsx
if (pathname.startsWith('/admin/locations')) return '/admin/locations';
```

In `features/admin/components/admin-mobile-nav.tsx`, add to `MORE_THEMED`:
```tsx
{ label: 'Locations', icon: 'home', href: '/admin/locations' },
```

- [ ] **Step 4: Verify build + typecheck**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: PASS. (No unit test for the page; it's covered by the Task 12 E2E.)

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/admin/locations apps/portal/src/features/admin/locations apps/portal/src/app/admin/page.tsx apps/portal/src/features/admin/components/admin-sidebar.tsx apps/portal/src/features/admin/components/admin-mobile-nav.tsx
git commit -m "feat(locations): /admin/locations editor page + admin nav entries"
```

---

### Task 6: Public `GET /api/setu/locations` + route wiring

**Files:**
- Create: `apps/portal/src/app/api/setu/locations/route.ts`
- Test: `apps/portal/src/app/api/setu/locations/__tests__/route.test.ts`
- Modify: `packages/shared-domain/src/auth/public-routes.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts` (or the existing can-access-route test file)
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

**Interfaces:**
- Consumes: `getLocationOptions` (Task 1).
- Produces: public `GET /api/setu/locations` → `{ options }`, reachable pre-auth (registration) and by any signed-in setu family.

- [ ] **Step 1: Write the handler test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/locations', () => ({ getLocationOptions: vi.fn() }));
import { GET } from '../route';
import { getLocationOptions } from '@/lib/locations';

beforeEach(() => { vi.clearAllMocks(); });
it('returns the current options', async () => {
  vi.mocked(getLocationOptions).mockResolvedValue(['Brampton', 'Scarborough']);
  const res = await GET();
  expect(res.status).toBe(200);
  expect((await res.json()).options).toEqual(['Brampton', 'Scarborough']);
});
```

- [ ] **Step 2: Add a `canAccessRoute` test** (in the existing can-access-route test file) proving the public path is allowed pre-auth and an admin PUT stays gated:

```ts
it('allows anonymous GET /api/setu/locations (public)', () => {
  expect(canAccessRoute(anonymousClaims, '/api/setu/locations', 'GET')).toBe(true);
});
```
(Use whatever "anonymous/empty claims" fixture the file already uses; `isPublicRoute` should short-circuit to `true`.)

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/locations && pnpm --filter @cmt/shared-domain exec vitest run src/auth`
Expected: FAIL — route module missing; canAccessRoute returns false for the new path.

- [ ] **Step 4: Implement the handler** (mirrors `api/setu/volunteering-skills/route.ts`)

```ts
// apps/portal/src/app/api/setu/locations/route.ts
import { NextResponse } from 'next/server';
import { getLocationOptions } from '@/lib/locations';

/** GET /api/setu/locations - public centre list for the pre-auth registration
 * picker (and any signed-in member). Read-only, non-sensitive org config. */
export async function GET() {
  return NextResponse.json({ options: await getLocationOptions() });
}
```

- [ ] **Step 5: Wire both auth lists**

In `packages/shared-domain/src/auth/public-routes.ts`, add next to the volunteering-skills entry:
```ts
'/api/setu/locations',
```
In `packages/shared-domain/src/auth/can-access-route.ts`, add a clause mirroring the volunteering-skills clause (before the `/api/setu/` catch-all), so authed members can also read it:
```ts
if (pathname === '/api/setu/locations' || pathname.startsWith('/api/setu/locations/')) {
  return isSetuFamily(claims);
}
```

- [ ] **Step 6: Add the MOBILE_API_CHANGELOG entry** — append a dated entry documenting the new `GET /api/setu/locations` (mobile should fetch the centre list here instead of hardcoding four). Key it with the commit SHA after committing (or a placeholder to update).

- [ ] **Step 7: Run both suites to verify they pass**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/locations && pnpm --filter @cmt/shared-domain exec vitest run src/auth`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/app/api/setu/locations packages/shared-domain/src/auth apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(locations): public GET /api/setu/locations + public-route wiring"
```

---

### Task 7: Write-time membership validation (register + calendar validators)

**Files:**
- Modify: `apps/portal/src/app/api/setu/register/route.ts:40` (+ handler membership check)
- Modify: `apps/portal/src/app/api/admin/calendar/route.ts:33`
- Modify: `apps/portal/src/app/api/admin/calendar/weekly/route.ts:20`
- Modify: `apps/portal/src/app/api/setu/calendar/route.ts:17`
- Test: `apps/portal/src/app/api/setu/register/__tests__/route.test.ts`
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

**Interfaces:**
- Consumes: `getLocationOptions` (Task 1).
- Produces: register + calendar routes accept any centre in the dynamic list and reject one that is not, returning `{ error: 'invalid-location' }` (400).

- [ ] **Step 1: Add/adjust the register test** — a location outside the config list is rejected:

```ts
// In the register route test, with getLocationOptions mocked to ['Brampton','Scarborough']:
it('rejects a location that is not a configured centre', async () => {
  const res = await POST(reqWithBody({ ...validBody, location: 'Nowhere' }));
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'invalid-location' });
});
it('accepts a configured centre', async () => {
  const res = await POST(reqWithBody({ ...validBody, location: 'Scarborough' }));
  expect(res.status).not.toBe(400);
});
```
(Mock `@/lib/locations` `getLocationOptions` in this test file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/register`
Expected: FAIL — currently the inline enum rejects `'Nowhere'` with a zod issue (not `invalid-location`), and `'Scarborough'` already passes; adjust after impl.

- [ ] **Step 3: Relax the register schema + add the membership check**

In `api/setu/register/route.ts`:
```ts
// L40
  location: z.string().min(1),
```
After body validation (and before/around the required-matrix step), add:
```ts
import { getLocationOptions } from '@/lib/locations';
// ...
const allowedLocations = await getLocationOptions();
if (!allowedLocations.includes(parsed.data.location)) {
  return NextResponse.json({ error: 'invalid-location' }, { status: 400 });
}
```

- [ ] **Step 4: Relax the three calendar validators** — replace `(LOCATIONS as readonly string[]).includes(location)` with a check against `await getLocationOptions()` in each of `admin/calendar/route.ts`, `admin/calendar/weekly/route.ts`, `setu/calendar/route.ts`, and drop the now-unused `LOCATIONS` import. Example:
```ts
import { getLocationOptions } from '@/lib/locations';
// ...
const locations = await getLocationOptions();
if (!location || !locations.includes(location)) {
  return NextResponse.json({ error: 'invalid-location' }, { status: 400 });
}
```
(Keep each route's existing error shape/status if it already returns a specific code; only swap the membership source.)

- [ ] **Step 5: Add the MOBILE_API_CHANGELOG entry** — `/api/setu/register` `location` changed from a 4-value enum to a dynamic string validated against `/api/setu/locations`; mobile should send a value from that endpoint.

- [ ] **Step 6: Run the register suite to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/register src/app/api/setu/calendar src/app/api/admin/calendar`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/api/setu/register apps/portal/src/app/api/admin/calendar apps/portal/src/app/api/setu/calendar apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(locations): validate location membership at register + calendar writes"
```

---

### Task 8: Dynamic location pickers (register client + admin dropdowns)

**Files:**
- Modify: `apps/portal/src/app/register/family/page.tsx` (type L15; prototype pills L66-75; real pills L489-510; add a fetch)
- Modify: `apps/portal/src/app/admin/calendar/page.tsx` (server: pass `getLocationOptions()`)
- Modify: `apps/portal/src/features/admin/programs/program-form.tsx` (L141)
- Modify: `apps/portal/src/features/admin/programs/offerings-panel.tsx` (L326)
- Modify: `apps/portal/src/features/admin/programs/programs-table.tsx` (L225)
- Modify: `apps/portal/src/features/setu/roster/roster-browser.tsx` (L308)

**Interfaces:**
- Consumes: `GET /api/setu/locations` (client) and `getLocationOptions()` (server).

- [ ] **Step 1: Register client reads the public endpoint.** In `register/family/page.tsx`:
  - Change `type Location = ...` (L15) to `type Location = string;`.
  - Add state + effect inside `RegisterFamilyReal`:
    ```tsx
    const [locationOptions, setLocationOptions] = useState<string[]>(['Brampton', 'Scarborough']);
    useEffect(() => {
      let cancelled = false;
      fetch('/api/setu/locations')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && Array.isArray(j?.options) && j.options.length) setLocationOptions(j.options as string[]); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, []);
    ```
  - Replace the real-form pills array `(['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const).map(l => ...)` (L492) with `locationOptions.map((l) => ...)` (keep the exact pill markup + `onClick={() => setLocation(l)}`).
  - The prototype block (L66-75, flag-off) is a non-functional visual mock; leave it but reduce its hardcoded array to `['Brampton', 'Scarborough']` so it doesn't advertise removed centres.

- [ ] **Step 2: Admin server dropdowns read config.** For each of `program-form.tsx`, `offerings-panel.tsx`, `programs-table.tsx`, `roster-browser.tsx` (all client components), thread a `locationOptions: string[]` prop from their server parent (which calls `await getLocationOptions()`), and replace `LOCATIONS.map(...)` with `locationOptions.map(...)`. For `app/admin/calendar/page.tsx`, replace `const locations = [...LOCATIONS]` with `const locations = await getLocationOptions();`.
  - Where a client component currently imports `LOCATIONS` from `@cmt/shared-domain` only for the dropdown, remove that import once the prop is used.
  - Find each component's server parent (e.g. the programs admin page renders `programs-table`/`program-form`; the welcome roster page renders `roster-browser`) and pass the prop. If a parent is itself a client component, lift the fetch to its server page or fetch `/api/setu/locations` client-side with the same effect pattern as Step 1.

- [ ] **Step 3: Typecheck + lint + affected unit tests**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Then run the programs/roster component tests that exist:
`pnpm --filter @cmt/portal exec vitest run src/features/admin/programs src/features/setu/roster src/app/register/family`
Expected: PASS. Update any test that rendered these components without the new `locationOptions` prop (pass `['Brampton','Scarborough']`).

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/app/register/family apps/portal/src/app/admin/calendar apps/portal/src/features/admin/programs apps/portal/src/features/setu/roster
git commit -m "feat(locations): location pickers read the dynamic admin-managed list"
```

---

### Task 9: Full-suite gate + runbook for Slice 1

**Files:**
- Modify: `docs/runbooks/production-cutover-checklist.md` (§10 row + §14 dated entry)

- [ ] **Step 1: Run the FULL portal + shared suites** (integration tests live in separate dirs; targeted globs miss them)

Run: `pnpm --filter @cmt/shared-domain test && pnpm --filter @cmt/portal test`
Expected: PASS. Fix any fixture that hardcoded a removed centre or a `locationOptions`-less render.

- [ ] **Step 2: Add the runbook entry** — §14 dated 2026-07-12: `app_config/locations` lazy-defaults to Brampton + Scarborough (no seed script); going-forward the centre set is admin-managed; standing pre-prod check "confirm no family/offering/level/enrollment references a centre outside the config set" (UAT verified clean 2026-07-12); add a §10 table row for the config doc. Do NOT run any prod write.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/production-cutover-checklist.md
git commit -m "docs(runbook): record admin-managed locations config (UAT)"
```

---

## SLICE 2 — Level Management redesign

### Task 10: `leadTeacherRef` data model + write path

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/level.ts` (add to `LevelDocSchema` + `UpdateLevelSchema`)
- Modify: `apps/portal/src/app/admin/levels/page.tsx` (field mapper L32-52)
- Modify: `apps/portal/src/app/api/admin/levels/[levelId]/route.ts` (PATCH validate + persist lead)
- Modify: `apps/portal/src/app/api/admin/levels/[levelId]/teachers/route.ts` (DELETE clears lead when the removed mid is the lead)
- Modify: `apps/portal/src/features/admin/levels/assign-teacher-client.ts` (add `setLevelLeadTeacherClient`)
- Test: `packages/shared-domain/src/setu/__tests__/level-schemas.test.ts`; `apps/portal/src/app/api/admin/levels/[levelId]/__tests__/route.test.ts` (if present, else create); teachers route test.

**Interfaces:**
- Produces: `LevelDoc.leadTeacherRef?: string | null`; `UpdateLevelInput.leadTeacherRef?: string | null`; PATCH enforces `leadTeacherRef ∈ teacherRefs` (else `{ error: 'lead-not-a-teacher' }` 400); DELETE-teacher clears `leadTeacherRef` when removing the lead; `setLevelLeadTeacherClient(levelId, mid: string | null): Promise<void>`.

- [ ] **Step 1: Schema test** — add to `level-schemas.test.ts`:

```ts
it('LevelDocSchema accepts an omitted, null, or string leadTeacherRef', () => {
  const base = { levelId: 'l1', programKey: 'bala-vihar', location: 'Brampton', levelName: 'L2',
    levelKind: 'level', order: 0, gradeBand: ['2'], curriculum: 'X', pid: 'p', periodLabel: '2026-27',
    teacherRefs: ['m1'], enabled: true, createdAt: new Date(), createdBy: 'u', updatedAt: new Date(), updatedBy: 'u' };
  expect(LevelDocSchema.parse(base).leadTeacherRef).toBeUndefined();
  expect(LevelDocSchema.parse({ ...base, leadTeacherRef: null }).leadTeacherRef).toBeNull();
  expect(LevelDocSchema.parse({ ...base, leadTeacherRef: 'm1' }).leadTeacherRef).toBe('m1');
});
it('UpdateLevelSchema accepts leadTeacherRef null|string', () => {
  expect(UpdateLevelSchema.parse({ leadTeacherRef: null }).leadTeacherRef).toBeNull();
  expect(UpdateLevelSchema.parse({ leadTeacherRef: 'm2' }).leadTeacherRef).toBe('m2');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/level-schemas.test.ts`
Expected: FAIL — `leadTeacherRef` stripped/unknown.

- [ ] **Step 3: Add the schema fields.** In `level.ts`:
```ts
// inside LevelDocSchema (after teacherRefs)
  leadTeacherRef: z.string().nullable().optional(), // one of teacherRefs marked as Lead; others render as Assistant
// inside UpdateLevelSchema (.object)
  leadTeacherRef: z.string().nullable().optional(),
```

- [ ] **Step 4: Carry it through the levels page mapper.** In `app/admin/levels/page.tsx`, add to the `levelsSnap.docs.map(...)` return object:
```ts
  leadTeacherRef: (data.leadTeacherRef ?? null) as string | null,
```
(`LevelRow = Omit<LevelDoc,...>` already types it; this line populates it.)

- [ ] **Step 5: PATCH validates + persists lead.** In `api/admin/levels/[levelId]/route.ts`, after `const existing = snap.data() as LevelDoc;`:
```ts
if (data.leadTeacherRef !== undefined) {
  if (data.leadTeacherRef !== null && !existing.teacherRefs.includes(data.leadTeacherRef)) {
    return NextResponse.json({ error: 'lead-not-a-teacher' }, { status: 400 });
  }
  update.leadTeacherRef = data.leadTeacherRef; // string or null
}
```

- [ ] **Step 6: DELETE-teacher clears the lead.** In `api/admin/levels/[levelId]/teachers/route.ts` DELETE handler, after computing the removal, if the removed `mid` equals the level's current `leadTeacherRef`, also clear it. Read the level doc in the handler (or extend `guard` to return it) and, when `snap.data()?.leadTeacherRef === mid`, write `leadTeacherRef: null` on the level doc (a `db.collection('levels').doc(levelId).update({ leadTeacherRef: null })` after the `assignTeacher` call). Add a test asserting removing the lead clears it.

- [ ] **Step 7: Client helper.** In `assign-teacher-client.ts`:
```ts
/** Set (or clear, with null) the Lead teacher for a level. Throws on non-OK. */
export async function setLevelLeadTeacherClient(levelId: string, mid: string | null): Promise<void> {
  const res = await fetch(`/api/admin/levels/${encodeURIComponent(levelId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadTeacherRef: mid }),
  });
  if (!res.ok) throw new Error(`set-lead-${res.status}`);
}
```

- [ ] **Step 8: Run the affected suites**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/level-schemas.test.ts && pnpm --filter @cmt/portal exec vitest run src/app/api/admin/levels`
Expected: PASS.

- [ ] **Step 9: MOBILE_API_CHANGELOG?** `/api/admin/*` is NOT part of the mobile `/api/setu/*` contract — no changelog entry needed. (Confirm the teacher route path is `/api/admin/...`, which it is.)

- [ ] **Step 10: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/level.ts packages/shared-domain/src/setu/__tests__ apps/portal/src/app/admin/levels/page.tsx apps/portal/src/app/api/admin/levels apps/portal/src/features/admin/levels/assign-teacher-client.ts
git commit -m "feat(levels): add leadTeacherRef (one Lead per level) with write guards"
```

---

### Task 11: Master-detail layout + always-one location filter + stat cards

**Files:**
- Modify: `apps/portal/src/features/admin/levels/levels-management.tsx` (owns filter state + selection + stat cards + renders master list + detail panel)
- Modify: `apps/portal/src/features/admin/levels/levels-table.tsx` (becomes the master LIST: selectable rows; teacher-management markup extracted to the panel in Task 12 — for this task, keep the existing inline teacher cell working)
- Modify: `apps/portal/src/app/admin/levels/page.tsx` (pass `locationOptions` from `getLocationOptions()`)

**Interfaces:**
- Consumes: `getLocationOptions()`; `LevelRow` (now carrying `leadTeacherRef`).
- Produces: filter state (`year` via existing switcher, `location: string` single-select always-one, `programKey`, `search`, `showDisabled`), `selectedLevelId: string | null`, and a derived filtered list. Stat cards: total / with-teachers / needing-teachers over the filtered list.

- [ ] **Step 1: Page passes location options.** In `app/admin/levels/page.tsx`, add `const locationOptions = await getLocationOptions();` (import from `@/lib/locations`) and pass `locationOptions={locationOptions}` to `<LevelsManagement/>`.

- [ ] **Step 2: `LevelsManagement` gains the filter bar + selection + stat cards.** Add props `locationOptions: string[]`. Add state:
```tsx
const [selectedLocation, setSelectedLocation] = useState<string>(locationOptions[0] ?? 'Brampton');
const [search, setSearch] = useState('');
const [showDisabled, setShowDisabled] = useState(false);
const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
```
Derive the filtered list (always exactly one location; never "all"):
```tsx
const filtered = levels
  .filter((l) => (l.location ?? 'Brampton') === selectedLocation)
  .filter((l) => showDisabled || l.enabled)
  .filter((l) => !search.trim() || `${l.levelName} ${l.curriculum}`.toLowerCase().includes(search.trim().toLowerCase()));
const stats = {
  total: filtered.length,
  withTeachers: filtered.filter((l) => l.teacherRefs.length > 0).length,
  needingTeachers: filtered.filter((l) => l.teacherRefs.length === 0).length,
};
```
Render, in order: the sticky filter bar (Location segmented control from `locationOptions` - a row of buttons, exactly one active, no "All"; plus the existing Program selector, the search input, and the "Show disabled" toggle), the three stat cards, then a two-column master-detail region (`display: grid; gridTemplateColumns: minmax(0,1fr) minmax(0, 380px)` on desktop, stacked on mobile via the existing `md:` pattern). Left = the levels list (pass `selectedLevelId` + `onSelectLevel={setSelectedLevelId}` to `LevelsTable`). Right = `<LevelDetailPanel>` (built in Task 12).

Segmented control (always-one-selected) markup:
```tsx
<div role="tablist" aria-label="Location" style={{ display: 'inline-flex', gap: 4, background: 'var(--surface2)', padding: 3, borderRadius: 999 }}>
  {locationOptions.map((loc) => {
    const active = loc === selectedLocation;
    return (
      <button key={loc} role="tab" aria-selected={active} onClick={() => { setSelectedLocation(loc); setSelectedLevelId(null); }}
        style={{ padding: '6px 14px', borderRadius: 999, border: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'var(--body-text)' }}>
        {loc}
      </button>
    );
  })}
</div>
```

- [ ] **Step 3: `LevelsTable` becomes a selectable master list.** Add props `selectedLevelId?: string | null` and `onSelectLevel?: (levelId: string) => void`. Make each desktop row and mobile card call `onSelectLevel?.(l.levelId)` on click and show a selected style when `l.levelId === selectedLevelId`. Remove the location column's role as the only location signal (the filter now scopes to one location) - it can stay as a column or be dropped since every row shares the selected location. Keep the existing per-row Edit/Enable controls and the existing inline teacher cell for now (Task 12 moves teacher management to the panel).

- [ ] **Step 4: Component test** for the filter logic (jsdom). Create `features/admin/levels/__tests__/levels-management-filter.test.tsx`:
```tsx
// Render LevelsManagement with two locations and 3 levels (2 Brampton incl. 1 disabled + 1 no-teacher, 1 Scarborough).
// Assert: default shows Brampton levels only; clicking the Scarborough segment swaps the list;
// stat cards read total/withTeachers/needingTeachers for the active location; "Show disabled" reveals the disabled one.
```
Use `@testing-library/react` + `@testing-library/user-event`, following the existing `levels-table-program-filter.test.tsx` pattern. Provide `locationOptions={['Brampton','Scarborough']}` and a realistic multi-instance `initialLevels`.

- [ ] **Step 5: Run typecheck + the component test**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal exec vitest run src/features/admin/levels`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/admin/levels/page.tsx apps/portal/src/features/admin/levels
git commit -m "feat(levels): master-detail shell with always-one location filter + stat cards"
```

---

### Task 12: Right-hand teacher detail panel (add/remove + Lead badges)

**Files:**
- Create: `apps/portal/src/features/admin/levels/level-detail-panel.tsx`
- Modify: `apps/portal/src/features/admin/levels/levels-management.tsx` (render the panel for the selected level; own the lead/teacher sync)
- Modify: `apps/portal/src/features/admin/levels/levels-table.tsx` (remove the inline teacher cell/popover now that the panel owns it, OR keep read-only pills in the row and make add/remove panel-only - choose panel-only to avoid two sources of truth)
- Test: `apps/portal/src/features/admin/levels/__tests__/level-detail-panel.test.tsx`

**Interfaces:**
- Consumes: `searchTeachersClient`, `addLevelTeacherClient`, `removeLevelTeacherClient`, `setLevelLeadTeacherClient` (Task 10), `TeacherHit`, `LevelTeacher`.
- Produces: `LevelDetailPanel` — shows the selected level's grades/curriculum/status and its teachers as pills with a Lead/Assistant badge, an add-teacher search (reuse `AssignTeacherPopover` markup), remove buttons, and a "Make Lead" control per teacher. Emits changes up so `LevelsManagement` keeps `levels[]` (`teacherRefs`, `leadTeacherRef`) in sync.

- [ ] **Step 1: Panel test** (jsdom). Render `LevelDetailPanel` for a level with 2 teachers, one of which is the lead:
```tsx
// Assert: the lead teacher shows a "Lead Teacher" badge, the other "Assistant Teacher";
// clicking "Make Lead" on the assistant calls setLevelLeadTeacherClient(levelId, m2) and moves the badge;
// clicking remove on a teacher calls removeLevelTeacherClient; empty-state renders when no level is selected.
```
Mock `./assign-teacher-client` (all four fns). Follow the existing `AssignTeacherPopover` search pattern (debounced `searchTeachersClient`).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/levels/__tests__/level-detail-panel.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Build `LevelDetailPanel`.** Props:
```tsx
interface LevelDetailPanelProps {
  level: LevelRow | null;                 // the selected level (null => empty state)
  teachers: LevelTeacher[];               // resolved {mid,name} for this level
  readOnly?: boolean;
  onTeacherAdded: (mid: string, name: string) => void;
  onTeacherRemoved: (mid: string) => void;
  onLeadChanged: (mid: string | null) => void;
}
```
Render: header (level name + status), grades/curriculum lines, then a "Teachers" section. For each teacher pill show a badge - `level.leadTeacherRef === t.mid ? 'Lead Teacher' : 'Assistant Teacher'` - a "Make Lead" button (hidden for the current lead), and a remove `×`. Below the pills, an "Add teacher" button that opens the existing `AssignTeacherPopover` (import/reuse it from `levels-table.tsx` - export it if not already, to avoid duplicating the debounced search). Handlers call the `-client` fns then the `on*` callbacks. Add-teacher: `addLevelTeacherClient(level.levelId, hit.mid)` then `onTeacherAdded`. Make-Lead: `setLevelLeadTeacherClient(level.levelId, mid)` then `onLeadChanged(mid)`. Remove: `removeLevelTeacherClient(level.levelId, mid)` then `onTeacherRemoved(mid)` (and if the removed mid was the lead, also `onLeadChanged(null)`). Follow the `feedback_nested_function_components_remount` rule - keep `AssignTeacherPopover` at module scope.

- [ ] **Step 4: Wire it in `LevelsManagement`.** Compute `selectedLevel = levels.find((l) => l.levelId === selectedLevelId) ?? null` and `selectedTeachers = teachers[selectedLevelId ?? ''] ?? []`. Render `<LevelDetailPanel level={selectedLevel} teachers={selectedTeachers} readOnly={readOnly} onTeacherAdded={...} onTeacherRemoved={...} onLeadChanged={...} />`. Update the local `teachers` map AND `levels[].teacherRefs`/`levels[].leadTeacherRef` in the handlers so the list stat cards + badges stay consistent (extend the existing `handleAssignmentSaved` or add dedicated setters). Move the `teachers` state up from `LevelsTable` into `LevelsManagement` (single source of truth), passing it down to both the list and the panel.

- [ ] **Step 5: Remove the inline teacher popover from the row** (panel-only teacher management). In `levels-table.tsx`, replace the interactive `teacherCell` with read-only pills (name + Lead/Assistant hint) or a simple teacher count, so add/remove happens ONLY in the panel. Delete now-dead handlers/imports; export `AssignTeacherPopover` for the panel's reuse.

- [ ] **Step 6: Run the panel test + typecheck + lint**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/levels && pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/admin/levels
git commit -m "feat(levels): right-hand teacher panel with Lead/Assistant badges"
```

---

### Task 13: Deployed-UAT E2E for locations editor + levels redesign

**Files:**
- Create: `apps/portal/e2e/setu/admin/locations.spec.ts`
- Create: `apps/portal/e2e/setu/admin/level-management-redesign.spec.ts`

**Interfaces:**
- Consumes: the deployed UAT app; the seeded `E2E_FAMILY_*` user (family-manager + admin); `hasFamilyCreds` from `../../_helpers`; the `setu` Playwright project (storageState `e2e/.auth/family.json`).

- [ ] **Step 1: Locations editor spec.** Gate with `test.skip(!hasFamilyCreds, ...)`. Flow, all via the deployed UI/API:
  - Navigate to `/admin/locations`; assert the current centres render.
  - Add a unique centre `E2E-Loc-${Date.now()}`, Save, assert success toast + it appears; assert it now appears in a location picker (e.g. GET `/api/setu/locations` returns it, or the register page shows it).
  - Remove that unused centre, Save, assert success.
  - Attempt to remove a **referenced** centre (Brampton) via a PUT and assert `409 location-in-use` with a count (assert against the API response to avoid destructive UI clicks).
  - `test.afterAll`: restore `app_config/locations` to its pre-test options via the admin SDK (capture the original list in `beforeAll`).
  Use `page.waitForResponse` on `/api/admin/locations` PUT (status 200/409) like the level-management spec waits on `/api/admin/levels`.

- [ ] **Step 2: Levels redesign spec.** Realistic fixture: create (via the existing admin level API or a seed) at least 2 levels at Brampton and 1 at Scarborough for the current year, with ≥2 assignable teachers. Flow:
  - Open `/admin/levels`; assert the Location segment defaults to the first centre and shows only its levels.
  - Click the Scarborough segment; assert the list swaps.
  - Click a level row; assert the right panel opens with that level's info.
  - Add a teacher (search + pick) → assert the pill + "Assistant Teacher" badge appear; assert the POST `/api/admin/levels/{id}/teachers` was 200.
  - Click "Make Lead" on that teacher → assert the badge flips to "Lead Teacher" and the PATCH `/api/admin/levels/{id}` `leadTeacherRef` was 200.
  - Remove the teacher → assert the pill disappears and (if it was lead) the lead clears.
  - `test.afterAll`: unwind `teacherAssignments` (arrayRemove) + delete created levels via the admin SDK, mirroring `level-management.spec.ts`.
  Use unique names (`${Date.now()}`); scope row queries with `getByRole('row').filter({ hasText: NAME })` (desktop table).

- [ ] **Step 3: Run both specs against deployed UAT**

Run: `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu locations.spec.ts level-management-redesign.spec.ts`
Expected: PASS (both specs green). If the deployed app predates this slice, deploy first (push Slice 2), then run.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/e2e/setu/admin/locations.spec.ts apps/portal/e2e/setu/admin/level-management-redesign.spec.ts
git commit -m "test(e2e): deployed-UAT specs for locations editor + levels redesign"
```

---

## Final: whole-branch review + verification

- Run the FULL suites one more time: `pnpm --filter @cmt/shared-domain test && pnpm --filter @cmt/portal test`.
- Push (pre-push hook runs typecheck + lint + test + build). If green, the deployed UAT updates.
- Run both E2E specs against `https://cmt-setu.vercel.app` and confirm green (mandatory pre-ship walkthrough).
- Confirm the two MOBILE_API_CHANGELOG entries (`/api/setu/register` location string; new `GET /api/setu/locations`) are present and SHA-keyed.
- Confirm the runbook §14 entry is present. No prod DB writes were performed.

---

## Self-Review (author checklist — completed)

**Spec coverage:** Part A (config lib T1, schema relax T2, membership validation T7, public endpoint T6, dynamic pickers T8) ✓; Part B (editor + guard T3/T4/T5) ✓; Part C (leadTeacherRef T10, master-detail + always-one filter + stat cards T11, teacher panel with many-teachers/one-Lead T12) ✓; testing/rollout (T9 full-suite+runbook, T13 E2E, changelog in T6/T7) ✓; two ordered sub-slices ✓.

**Type consistency:** `getLocationOptions/setLocationOptions/DEFAULT_LOCATIONS` (T1) used identically in T4–T8. `countLocationReferences` (T3) → T4. `leadTeacherRef: string | null` consistent across schema (T10), mapper (T10), PATCH (T10), panel (T12). `setLevelLeadTeacherClient(levelId, mid|null)` (T10) → T12. `locationOptions: string[]` prop name consistent T8/T11. Segmented control is always-one-selected (no "All") per spec.

**No placeholders:** every code step shows real code; the two spots that say "mirror the existing markup" (LocationsEditor JSX from skills-editor; LevelsTable row markup) point at exact template files with line ranges in the digest, because transcribing 600 lines of existing JSX verbatim is not additive — the structural logic, props, handlers, and tests are all specified.
