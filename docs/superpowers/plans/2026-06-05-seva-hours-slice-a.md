# Seva Hours — Slice A (Foundation + Opportunity Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin & welcome-team can set the seva year + 20-hour target and create/edit/close **seva opportunities**, on a modern, on-theme management screen.

**Architecture:** Greenfield `seva` domain. Pure Zod schemas in `@cmt/shared-domain`; a config read/write lib + an opportunities server reader in the portal; `/api/welcome/seva/*` (welcome+admin) and `/api/admin/seva/requirement` (admin) routes mirroring the existing programs routes; a themed `/welcome/seva` management page. UAT-only Firestore indexes. No signup/hours logic yet — that's Slice B/C.

**Tech Stack:** Next.js 16 App Router (Cache Components), TypeScript (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`), Zod, Firebase Admin (UAT `chinmaya-setu-uat`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-05-seva-hours-design.md`.

---

## Design system / UX requirements (apply to EVERY screen in this slice)

The management UI must look **modern and match the Setu theme** (Cool Mist + orange CTA). Non-negotiables:

- **Brand-token scoping:** brand tokens only resolve inside a `CspRoot`/`.csp` subtree (see memory `feedback_csp_token_scoping`). The `/welcome/*` layout already wraps children in `CspRoot`, so page content inherits tokens — but any `position:fixed`/overlay/modal rendered outside that subtree MUST add `className="csp"` or be wrapped in `CspRoot`, or it renders unstyled.
- **Tokens (use these, never hardcoded hex):** `--accent` (orange CTA), `--accentSoft`, `--accentDeep`, `--bg`, `--surface`, `--surface2`, `--line`, `--line2`, `--muted`, `--ink`, `--body-text`, `--radius`, `--radiusSm`, `--err`.
- **Classes:** `card`, `btn btn--p` (primary/orange), `btn--s` (secondary), `btn--g` (ghost), `btn--block`, `input`, `field`, `row`, `col`, `between`, `pill`, `focus-ring`. Headings use the light-weight large style (see existing admin pages); script-accent via `<em className="sa">`.
- **Components:** import `SetuIcon`, `SetuLogo`, `toast`, `Rosette` from `@cmt/ui`; `CspRoot`, `SectionLabel`, `FieldError` from `@/features/family/components/atoms`.
- **Responsive:** every page renders a mobile block (`className="block md:hidden"`) and a desktop block (`className="hidden md:block"`), mirroring `apps/portal/src/app/admin/programs/page.tsx` + `apps/portal/src/features/admin/programs/programs-table.tsx` / `offerings-panel.tsx`. The `/welcome` layout owns the sidebar/mobile-nav chrome; pages render content only.
- **Accessibility:** real `<button>`/`<label>`/`aria-*`; focus-visible via `focus-ring`; dialogs get `role="dialog" aria-modal`.
- **Visual pass:** after the structure + tests are in place for the UI tasks (A8), dispatch the **`oh-my-claudecode:designer`** agent (model: opus) to refine spacing, hierarchy, empty states, and micro-interactions against these tokens — do NOT invent a new visual language; match `/admin/programs` and `/welcome`.

Reference implementations to mirror (read before building UI): `apps/portal/src/app/admin/programs/page.tsx`, `apps/portal/src/features/admin/programs/{programs-table,program-form,offerings-panel}.tsx`, `apps/portal/src/app/welcome/page.tsx`, `apps/portal/src/app/welcome/layout.tsx`.

---

## Mobile-app readiness (REQUIRED — applies to every API + every screen in this slice and all later slices)

A native mobile app will consume these APIs later, so build them mobile-consumable from day one:

- **Auth via the header session, NOT cookies.** The middleware already accepts EITHER the `__session` cookie OR an `Authorization: Bearer <Firebase ID token>` (`middleware.ts:85`), verifies it, and injects `x-portal-role/uid/fid/mid/extra-roles` request headers; it also runs `applyCors`. **Every API handler MUST derive identity from `readSessionFromHeaders(req)`** (which reads those injected headers) — NEVER from `getCurrentFamily()` / `cookies()` directly, because the Bearer path sets no cookie and those return null for a mobile client. All Slice A routes already use `readSessionFromHeaders` — keep it that way. (Critical for Slice B: the family signup route must bind `fid`/`mid` from `readSessionFromHeaders(req)`, not `getCurrentFamily()`.)
- **CORS / cross-origin.** `/api/welcome/seva/*` and `/api/setu/seva/*` must stay reachable cross-origin like the other `/api/*` routes — don't add handler logic that breaks preflight or assumes same-origin. The middleware's `applyCors` covers it; just don't fight it.
- **JSON-only, fully serializable payloads.** Consistent envelope — `{ opportunities }` / `{ requirement }` / `{ oppId }` on success, `{ error, issues? }` on failure. **All dates as ISO strings** (`serializeOpportunity` already does this) — never raw Firestore `Timestamp` or `Date` instances in a response. Numbers stay numbers (hours/capacity), not strings.
- **No web-only assumptions in handlers.** No reliance on `Referer`, redirects, or HTML responses — these are pure data endpoints a mobile client calls. (Server-internal concerns like `revalidateTag` are fine.)
- **One shared contract.** Request/response shapes live in the Zod schemas in `@cmt/shared-domain` (single source of truth) so web + mobile import the same types; field names match the schema (`oppId`, `defaultHours`, `sevaYear`, `status`, …).

**Mobile view (UI):** every screen ships a *real* mobile layout (`block md:hidden`) alongside desktop (`hidden md:block`) — not a desktop layout crammed onto a phone. Verify both at ~375px and desktop widths; primary actions reachable with a thumb, no horizontal scroll.

---

## File structure

**Create:**
- `packages/shared-domain/src/setu/schemas/seva.ts` — `SevaRequirementConfigSchema`, `SevaOpportunityDocSchema`, `SevaOpportunityStatus`, `CreateSevaOpportunitySchema`, `UpdateSevaOpportunitySchema` + types.
- `apps/portal/src/lib/seva-requirement.ts` — `getSevaRequirement()`, `setSevaRequirement()`, `DEFAULT_SEVA_REQUIREMENT`.
- `apps/portal/src/features/setu/seva/get-opportunities.ts` — `listOpportunities()`, `getOpportunity(oppId)`, `serializeOpportunity()`.
- `apps/portal/src/app/api/admin/seva/requirement/route.ts` — `GET`/`PUT` (admin).
- `apps/portal/src/app/api/welcome/seva/opportunities/route.ts` — `GET`/`POST` (welcome+admin).
- `apps/portal/src/app/api/welcome/seva/opportunities/[oppId]/route.ts` — `PATCH` (welcome+admin).
- `apps/portal/src/features/admin/seva/opportunities-client.ts` — client fetch wrappers.
- `apps/portal/src/features/admin/seva/seva-manager.tsx` — client management UI (config panel + opportunity list + create/edit form).
- `apps/portal/src/app/welcome/seva/page.tsx` — themed server page.
- Tests alongside each (`__tests__/`).

**Modify:**
- `packages/shared-domain/src/setu/index.ts` (or schema barrel) — export the seva schemas/types.
- `packages/shared-domain/src/auth/can-access-route.ts` — add `/api/welcome/seva/*` → `isWelcomeTeam`.
- `packages/shared-domain/src/__tests__/can-access-route.test.ts` — assertions.
- `firestore.indexes.json` — `seva_opportunities (sevaYear, status, date)` index.
- Welcome nav + admin sidebar — add a **Seva** entry (`apps/portal/src/app/admin/layout.tsx`, the welcome layout/sidebar, and the relevant mobile navs).

---

## Task A1: Seva schemas (shared-domain)

**Files:**
- Create: `packages/shared-domain/src/setu/schemas/seva.ts`
- Create: `packages/shared-domain/src/setu/schemas/__tests__/seva.test.ts`
- Modify: the setu schema barrel that re-exports schemas (follow how `member.ts`/`offering.ts` are exported — check `packages/shared-domain/src/setu/index.ts` and `packages/shared-domain/src/index.ts`).

- [ ] **Step 1: Write the failing test** (`seva.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import {
  SevaRequirementConfigSchema,
  SevaOpportunityDocSchema,
  CreateSevaOpportunitySchema,
  UpdateSevaOpportunitySchema,
} from '../seva';

describe('SevaRequirementConfigSchema', () => {
  it('accepts a target + nullable seva year', () => {
    expect(SevaRequirementConfigSchema.parse({ hoursPerYear: 20, currentSevaYear: '2025-26' }).hoursPerYear).toBe(20);
    expect(SevaRequirementConfigSchema.parse({ hoursPerYear: 20, currentSevaYear: null }).currentSevaYear).toBeNull();
  });
  it('rejects a non-positive target', () => {
    expect(SevaRequirementConfigSchema.safeParse({ hoursPerYear: 0, currentSevaYear: null }).success).toBe(false);
  });
});

describe('SevaOpportunityDocSchema', () => {
  const base = {
    oppId: 'opp1', title: 'Diwali setup', description: '', date: new Date(),
    location: '', defaultHours: 4, capacity: null, sevaYear: '2025-26',
    status: 'open' as const, createdAt: new Date(), createdBy: 'u1',
    updatedAt: new Date(), updatedBy: 'u1',
  };
  it('parses a valid opportunity', () => {
    expect(SevaOpportunityDocSchema.parse(base).title).toBe('Diwali setup');
  });
  it('rejects defaultHours <= 0 and status outside the enum', () => {
    expect(SevaOpportunityDocSchema.safeParse({ ...base, defaultHours: 0 }).success).toBe(false);
    expect(SevaOpportunityDocSchema.safeParse({ ...base, status: 'past' }).success).toBe(false);
  });
});

describe('CreateSevaOpportunitySchema', () => {
  it('defaults description/location to "" and capacity to null', () => {
    const p = CreateSevaOpportunitySchema.parse({ title: 'X', date: '2026-01-01', defaultHours: 3 });
    expect(p.description).toBe('');
    expect(p.location).toBe('');
    expect(p.capacity).toBeNull();
  });
  it('rejects an empty title and non-positive hours', () => {
    expect(CreateSevaOpportunitySchema.safeParse({ title: '', date: '2026-01-01', defaultHours: 3 }).success).toBe(false);
    expect(CreateSevaOpportunitySchema.safeParse({ title: 'X', date: '2026-01-01', defaultHours: 0 }).success).toBe(false);
  });
});

describe('UpdateSevaOpportunitySchema', () => {
  it('is fully partial and allows closing', () => {
    expect(UpdateSevaOpportunitySchema.parse({ status: 'closed' }).status).toBe('closed');
    expect(UpdateSevaOpportunitySchema.parse({}).title).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, confirm failure** — `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/seva.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`seva.ts`)

```ts
import { z } from 'zod';

export const SevaRequirementConfigSchema = z.object({
  hoursPerYear: z.number().int().positive(),
  currentSevaYear: z.string().min(1).nullable(),
});
export type SevaRequirementConfig = z.infer<typeof SevaRequirementConfigSchema>;

export const SevaOpportunityStatus = z.enum(['open', 'closed']);
export type SevaOpportunityStatusType = z.infer<typeof SevaOpportunityStatus>;

export const SevaOpportunityDocSchema = z.object({
  oppId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  date: z.date(),
  location: z.string(),
  defaultHours: z.number().positive(),
  capacity: z.number().int().positive().nullable(),
  sevaYear: z.string().min(1),
  status: SevaOpportunityStatus,
  createdAt: z.date(),
  createdBy: z.string(),
  updatedAt: z.date(),
  updatedBy: z.string(),
});
export type SevaOpportunityDoc = z.infer<typeof SevaOpportunityDocSchema>;

// API input (client sends date as an ISO string; the route converts to Date).
export const CreateSevaOpportunitySchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  date: z.string().min(1),
  location: z.string().max(200).optional().default(''),
  defaultHours: z.number().positive().max(100),
  capacity: z.number().int().positive().max(10000).nullable().optional().default(null),
});
export type CreateSevaOpportunityInput = z.infer<typeof CreateSevaOpportunitySchema>;

export const UpdateSevaOpportunitySchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    date: z.string().min(1).optional(),
    location: z.string().max(200).optional(),
    defaultHours: z.number().positive().max(100).optional(),
    capacity: z.number().int().positive().max(10000).nullable().optional(),
    status: SevaOpportunityStatus.optional(),
  })
  .strict();
export type UpdateSevaOpportunityInput = z.infer<typeof UpdateSevaOpportunitySchema>;
```

- [ ] **Step 4: Export from the barrel(s)** — add `export * from './schemas/seva';` where `member`/`offering` are exported (match the existing pattern; verify `@cmt/shared-domain` and `@cmt/shared-domain/setu` both surface the new symbols). Add a line to `packages/shared-domain/src/__tests__/index.test.ts` if it asserts the export surface.

- [ ] **Step 5: Run tests** → PASS. Run `pnpm --filter @cmt/shared-domain exec vitest run`.

- [ ] **Step 6: Commit** — `feat(seva): schemas for requirement config + opportunities`

---

## Task A2: Requirement config lib (read/write with default)

**Files:**
- Create: `apps/portal/src/lib/seva-requirement.ts`
- Create: `apps/portal/src/lib/__tests__/seva-requirement.test.ts`

Mirrors `apps/portal/src/lib/volunteering-skills.ts` exactly (same `app_config` single-doc, read-with-default, no lazy write).

- [ ] **Step 1: Failing test**

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

import { getSevaRequirement, setSevaRequirement, DEFAULT_SEVA_REQUIREMENT } from '../seva-requirement';

beforeEach(() => vi.clearAllMocks());

describe('getSevaRequirement', () => {
  it('returns the default when the doc is missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getSevaRequirement()).toEqual(DEFAULT_SEVA_REQUIREMENT);
  });
  it('returns stored config', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ hoursPerYear: 25, currentSevaYear: '2025-26' }) });
    expect(await getSevaRequirement()).toEqual({ hoursPerYear: 25, currentSevaYear: '2025-26' });
  });
  it('falls back to defaults for malformed data', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ hoursPerYear: 'oops' }) });
    expect(await getSevaRequirement()).toEqual(DEFAULT_SEVA_REQUIREMENT);
  });
});

describe('setSevaRequirement', () => {
  it('writes config with a server timestamp', async () => {
    mockSet.mockResolvedValue(undefined);
    await setSevaRequirement({ hoursPerYear: 20, currentSevaYear: '2025-26' });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ hoursPerYear: 20, currentSevaYear: '2025-26', updatedAt: 'SERVER_TS' }),
    );
  });
});
```

- [ ] **Step 2: Run, confirm fail** — `pnpm --filter @cmt/portal exec vitest run src/lib/__tests__/seva-requirement.test.ts`.

- [ ] **Step 3: Implement**

```ts
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { SevaRequirementConfigSchema, type SevaRequirementConfig } from '@cmt/shared-domain';

export const DEFAULT_SEVA_REQUIREMENT: SevaRequirementConfig = { hoursPerYear: 20, currentSevaYear: null };

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'seva_requirement';

export async function getSevaRequirement(): Promise<SevaRequirementConfig> {
  const snap = await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_SEVA_REQUIREMENT };
  const parsed = SevaRequirementConfigSchema.safeParse(snap.data());
  return parsed.success ? parsed.data : { ...DEFAULT_SEVA_REQUIREMENT };
}

export async function setSevaRequirement(config: SevaRequirementConfig): Promise<void> {
  await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set({
    hoursPerYear: config.hoursPerYear,
    currentSevaYear: config.currentSevaYear,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(seva): requirement config read/write lib`.

---

## Task A3: Opportunities server reader

**Files:**
- Create: `apps/portal/src/features/setu/seva/get-opportunities.ts`
- Create: `apps/portal/src/features/setu/seva/__tests__/get-opportunities.test.ts`

- [ ] **Step 1: Failing test** — mock `portalFirestore`; assert `listOpportunities()` maps docs (Timestamp→Date) and supports `{ sevaYear, status }` filters; `serializeOpportunity` returns ISO strings for `date/createdAt/updatedAt`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockCollection = vi.fn();
const mockDocGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockDocGet }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
}));

import { listOpportunities, getOpportunity, serializeOpportunity } from '../get-opportunities';

const ts = (d: Date) => ({ toDate: () => d });
const row = (over = {}) => ({
  oppId: 'o1', title: 'Setup', description: '', date: ts(new Date('2026-01-01')),
  location: 'Hall', defaultHours: 4, capacity: null, sevaYear: '2025-26', status: 'open',
  createdAt: ts(new Date()), createdBy: 'u', updatedAt: ts(new Date()), updatedBy: 'u', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockOrderBy.mockReturnValue({ get: mockGet });
  mockWhere.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, get: mockGet });
  mockCollection.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, doc: mockDoc, get: mockGet });
  mockGet.mockResolvedValue({ docs: [{ data: () => row() }] });
});

describe('listOpportunities', () => {
  it('maps docs and applies sevaYear + status filters', async () => {
    const res = await listOpportunities({ sevaYear: '2025-26', status: 'open' });
    expect(res).toHaveLength(1);
    expect(res[0]!.date).toBeInstanceOf(Date);
    expect(mockWhere).toHaveBeenCalledWith('sevaYear', '==', '2025-26');
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'open');
  });
});

describe('getOpportunity', () => {
  it('returns null when missing', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    expect(await getOpportunity('nope')).toBeNull();
  });
});

describe('serializeOpportunity', () => {
  it('ISO-stringifies dates', () => {
    const s = serializeOpportunity({ ...row(), date: new Date('2026-01-01'), createdAt: new Date(), updatedAt: new Date() } as never);
    expect(typeof s.date).toBe('string');
  });
});
```

- [ ] **Step 2: Confirm fail.**
- [ ] **Step 3: Implement** — `listOpportunities(filters?)` builds `collection('seva_opportunities')`, chains `.where('sevaYear','==',…)` / `.where('status','==',…)` when provided, `.orderBy('date','asc')`, maps each doc's Timestamps to `Date` into a `SevaOpportunityDoc`. `getOpportunity(oppId)` reads the doc, returns mapped doc or null. `serializeOpportunity(o)` → `{ ...o, date: o.date.toISOString(), createdAt: …, updatedAt: … }`. (Mirror `apps/portal/src/app/api/setu/programs/route.ts`'s serialize + `get-programs`.)
- [ ] **Step 4: Run → PASS. Step 5: Commit** — `feat(seva): opportunities server reader`.

---

## Task A4: Admin requirement-config API

**Files:**
- Create: `apps/portal/src/app/api/admin/seva/requirement/route.ts`
- Create: `.../requirement/__tests__/route.test.ts`

Mirror `apps/portal/src/app/api/admin/programs/route.ts` auth (readSessionFromHeaders → isAdmin) and `/api/admin/volunteering-skills` shape.

- [ ] **Step 1: Failing test** — GET: 401 no session, 403 non-admin, 200 returns config (mock `@/lib/seva-requirement`). PUT: 403 non-admin, 400 bad body (e.g. `hoursPerYear: 0`), 200 persists (`setSevaRequirement` called with parsed body). Mock `next/cache` is NOT needed (no revalidateTag) — but if you add one, mock it.
- [ ] **Step 2: Confirm fail.**
- [ ] **Step 3: Implement**

```ts
import { NextResponse } from 'next/server';
import { isAdmin, SevaRequirementConfigSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSevaRequirement, setSevaRequirement } from '@/lib/seva-requirement';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  return NextResponse.json({ requirement: await getSevaRequirement() });
}

export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  const raw = await req.json().catch(() => null);
  const parsed = SevaRequirementConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  await setSevaRequirement(parsed.data);
  return NextResponse.json({ requirement: parsed.data });
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `feat(seva): admin requirement-config API`.

---

## Task A5: Management opportunities API (welcome + admin)

**Files:**
- Create: `apps/portal/src/app/api/welcome/seva/opportunities/route.ts` (GET list, POST create)
- Create: `apps/portal/src/app/api/welcome/seva/opportunities/[oppId]/route.ts` (PATCH edit/close)
- Create: `__tests__/route.test.ts` for both.

Auth: `readSessionFromHeaders` → `isWelcomeTeam(session)` (admin inherits welcome-team). Mirror programs route for the create/serialize shape; mock `next/cache` in tests if you call `revalidateTag` (use tag `seva-opportunities`).

- [ ] **Step 1: Failing tests** — GET: 401, 403 (non-welcome e.g. `family-manager`), 200 list. POST: 403 non-welcome; 400 invalid body; **409/400 when `currentSevaYear` is null** (must set the year first → error `seva-year-not-set`); 201 with `oppId` on success, stamping `sevaYear` from `getSevaRequirement()` and `status:'open'`, `defaultHours`/`capacity` persisted. PATCH: 403 non-welcome; 404 when missing; 200 on edit; 200 on `{status:'closed'}`.
- [ ] **Step 2: Confirm fail.**
- [ ] **Step 3: Implement POST/GET** (`opportunities/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isWelcomeTeam, CreateSevaOpportunitySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from '@/features/setu/seva/get-opportunities';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const sevaYear = searchParams.get('sevaYear') ?? undefined;
  const opportunities = (await listOpportunities(sevaYear ? { sevaYear } : undefined)).map(serializeOpportunity);
  return NextResponse.json({ opportunities });
}

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = CreateSevaOpportunitySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return NextResponse.json({ error: 'seva-year-not-set' }, { status: 400 });
  }

  const db = portalFirestore();
  const oppId = randomUUID();
  const now = FieldValue.serverTimestamp();
  await db.collection('seva_opportunities').doc(oppId).set({
    oppId,
    title: parsed.data.title,
    description: parsed.data.description,
    date: new Date(parsed.data.date),
    location: parsed.data.location,
    defaultHours: parsed.data.defaultHours,
    capacity: parsed.data.capacity,
    sevaYear: currentSevaYear,
    status: 'open',
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  });
  revalidateTag('seva-opportunities', 'max');
  return NextResponse.json({ oppId }, { status: 201 });
}
```

> Note `randomUUID` from `node:crypto` is fine in a route handler. If you prefer the `CMT-`/slug style used elsewhere, mirror `register-family`'s id generator — but a UUID is acceptable for an internal opportunity id.

- [ ] **Step 4: Implement PATCH** (`[oppId]/route.ts`) — `readSessionFromHeaders` → `isWelcomeTeam`; `await ctx.params` for `oppId`; `UpdateSevaOpportunitySchema.safeParse`; read the doc (404 if missing); build `updates` from provided fields (convert `date` string → `Date` when present); `txn`/`set(...,{merge:true})` with `updatedAt`/`updatedBy`; `revalidateTag('seva-opportunities','max')`; 200. (Mirror `apps/portal/src/app/api/admin/programs/[key]/route.ts`.)

- [ ] **Step 5: Run both test files → PASS. Step 6: Commit** — `feat(seva): management opportunities API (welcome + admin)`.

---

## Task A6: Route access control

**Files:**
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Modify: `packages/shared-domain/src/__tests__/can-access-route.test.ts`

- [ ] **Step 1: Failing test** — add a describe block:

```ts
describe('canAccessRoute — /api/welcome/seva/* — welcome-team + admin', () => {
  it('allows welcome-team and admin', () => {
    expect(canAccessRoute(welcomeTeam, '/api/welcome/seva/opportunities', 'POST')).toBe(true);
    expect(canAccessRoute(admin, '/api/welcome/seva/opportunities', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/welcome/seva/opportunities/abc', 'PATCH')).toBe(true);
  });
  it('denies family + teacher', () => {
    expect(canAccessRoute(manager, '/api/welcome/seva/opportunities', 'GET')).toBe(false);
    expect(canAccessRoute(member, '/api/welcome/seva/opportunities', 'POST')).toBe(false);
    expect(canAccessRoute(teacher, '/api/welcome/seva/opportunities', 'GET')).toBe(false);
  });
});
describe('canAccessRoute — /api/admin/seva/requirement — admin only', () => {
  it('allows admin, denies welcome-team', () => {
    expect(canAccessRoute(admin, '/api/admin/seva/requirement', 'PUT')).toBe(true);
    expect(canAccessRoute(welcomeTeam, '/api/admin/seva/requirement', 'PUT')).toBe(false);
  });
});
```

- [ ] **Step 2: Confirm fail** (the welcome/seva path currently default-denies).
- [ ] **Step 3: Implement** — in `can-access-route.ts`, alongside the other `/api/welcome/*` rules (near the `/api/welcome/enrollments` block), add:

```ts
  // Seva management — opportunities + signup rosters + confirmations: admin + welcome-team.
  if (pathname === '/api/welcome/seva' || pathname.startsWith('/api/welcome/seva/')) {
    return isWelcomeTeam(claims);
  }
```

(`/api/admin/seva/requirement` is already covered by the generic `/api/admin/*` → `isAdmin` rule; the test just locks that in. `/welcome/seva` *pages* are already covered by `/welcome/*` → `isWelcomeTeam`.)

- [ ] **Step 4: Run** `pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/can-access-route.test.ts` → PASS. **Step 5: Commit** — `feat(seva): canAccessRoute for /api/welcome/seva/*`.

---

## Task A7: Firestore index

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 1** — add a composite index for `seva_opportunities`:

```json
{ "collectionGroup": "seva_opportunities", "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "sevaYear", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "date", "order": "ASCENDING" }
  ] }
```

- [ ] **Step 2** — deploy to **UAT only**: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` (NEVER `--force`, NEVER against prod `715b8` — see CLAUDE.md + memory). Leave the CLI's "extra indexes" warning alone.
- [ ] **Step 3: Commit** — `chore(seva): seva_opportunities composite index (UAT)`.

> The `seva_signups` indexes land in Slice B/C when that collection is first queried.

---

## Task A8: Management UI — `/welcome/seva` (themed, responsive)

**Files:**
- Create: `apps/portal/src/features/admin/seva/opportunities-client.ts`
- Create: `apps/portal/src/features/admin/seva/seva-manager.tsx`
- Create: `apps/portal/src/features/admin/seva/__tests__/seva-manager.test.tsx`
- Create: `apps/portal/src/app/welcome/seva/page.tsx`

Read the **Design system / UX requirements** section above first. Mirror `admin/programs/page.tsx` (server page → client table/manager) and the offerings-panel form patterns.

- [ ] **Step 1: Client wrappers** (`opportunities-client.ts`) — `listOpportunities()` (GET), `createOpportunity(input)` (POST), `updateOpportunity(oppId, patch)` (PATCH), `getRequirement()`/`saveRequirement(cfg)` (the admin requirement GET/PUT). Each returns `{ ok, ... }` and is the thing component tests mock (route handlers are server-only).

- [ ] **Step 2: Write the SevaManager component test** (`seva-manager.test.tsx`) — mock `@cmt/ui` (`toast`, `SetuIcon`) and `../opportunities-client`. Assert: renders the current seva-year + target; renders an opportunity row from `initialOpportunities`; "New opportunity" opens the form; submitting valid fields calls `createOpportunity` with the typed values; "Close" calls `updateOpportunity(oppId,{status:'closed'})`; the requirement panel's Save (admin-only) calls `saveRequirement`. Keep assertions behavior-level.

- [ ] **Step 3: Implement `SevaManager`** (client) — props `{ initialRequirement, initialOpportunities, canEditRequirement }` (the page passes `canEditRequirement` = viewer is admin). Structure:
  - **Seva-year panel** (`card`): shows `currentSevaYear` (or a "No seva year set — set one to start posting opportunities" callout in `--accentSoft`) + `hoursPerYear`. If `canEditRequirement`, an inline edit (year text input like `2025-26` + hours number) → `saveRequirement`. If not admin, read-only.
  - **Opportunities section:** a "New opportunity" `btn btn--p` opens a themed form (inline panel or a `CspRoot`/`csp`-wrapped dialog — remember token scoping). Fields: title, date (`<input type="date">`), defaultHours (number), capacity (number, blank=unlimited), location, description (`<textarea className="input">`). Submit → `createOpportunity` → toast + refresh list. Each opportunity renders as a `card` row: title, date (America/Toronto), `defaultHours` + capacity, a status `pill` (`open` = accentSoft/accentDeep; `closed` = surface2/muted), and Edit / Close actions.
  - All buttons real `<button>`; CTA = `btn--p` (orange); secondary = `btn--s`; destructive-ish Close = `btn--g` or a bordered `--err` button. Use `toast` for success/error.
  - Render a **mobile block + desktop block** per the UX rules.

- [ ] **Step 4: Implement the page** (`app/welcome/seva/page.tsx`) — server component:

```tsx
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from '@/features/setu/seva/get-opportunities';
import { SevaManager } from '@/features/admin/seva/seva-manager';

export const metadata = { title: 'Seva — CMT Portal' };

export default async function WelcomeSevaPage() {
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  const canEditRequirement = !!raw && isAdmin(raw as unknown as WithRole);

  const [requirement, opportunities] = await Promise.all([
    getSevaRequirement(),
    listOpportunities(),
  ]);
  return (
    <SevaManager
      initialRequirement={requirement}
      initialOpportunities={opportunities.map(serializeOpportunity)}
      canEditRequirement={canEditRequirement}
    />
  );
}
```

- [ ] **Step 5: Run the component test → PASS**, then `pnpm --filter @cmt/portal exec tsc --noEmit`.
- [ ] **Step 6: Designer pass** — dispatch `oh-my-claudecode:designer` (model opus) to refine `seva-manager.tsx` spacing/hierarchy/empty-states against the tokens, **without** changing behavior or breaking the tests. Re-run the component test + typecheck after.
- [ ] **Step 7: Commit** — `feat(seva): themed /welcome/seva opportunity management UI`.

---

## Task A9: Navigation entries

**Files:**
- Modify: the welcome layout/sidebar (find it: `apps/portal/src/app/welcome/layout.tsx` and any `DesktopSidebar`/welcome mobile nav) — add **Seva** → `/welcome/seva`.
- Modify: `apps/portal/src/app/admin/layout.tsx` — add **Seva** (`/welcome/seva`) to the admin sidebar (admins manage seva there too); and `apps/portal/src/features/admin/components/admin-mobile-nav.tsx` MORE list.

- [ ] **Step 1** — add the nav links (match each file's existing item shape; pick an existing `SetuIcon` key such as `people`/`check`). If a nav test asserts the item list, update it in the same commit.
- [ ] **Step 2** — `pnpm --filter @cmt/portal exec vitest run` for any touched nav tests; `tsc --noEmit`.
- [ ] **Step 3: Commit** — `feat(seva): nav entries for /welcome/seva`.

---

## Slice A verification (before declaring done)

- [ ] `pnpm --filter @cmt/portal exec tsc --noEmit` → 0 errors.
- [ ] `pnpm lint` → clean.
- [ ] `pnpm --filter @cmt/portal exec vitest run` + `pnpm --filter @cmt/shared-domain exec vitest run` → green.
- [ ] Index deployed to UAT (`chinmaya-setu-uat`) only.
- [ ] Final review pass (subagent-driven: spec-compliance reviewer then code-quality reviewer; or a single `oh-my-claudecode:code-reviewer` on Opus for inline execution).
- [ ] **Mobile-app readiness:** every API handler derives identity via `readSessionFromHeaders(req)` (no `getCurrentFamily()`/`cookies()` in handlers); responses are JSON with ISO-string dates and the documented envelope; nothing breaks cross-origin/preflight. Every screen has a real mobile block + desktop block.
- [ ] **Mock-free walkthrough (per CLAUDE.md):** on deployed UAT, sign in as admin → `/welcome/seva` → set the seva year + target → create an opportunity → edit it → close it (walk it on **mobile + desktop**). Then sign in as a welcome-team user → confirm they can create/edit but NOT change the requirement target. Report UAT status explicitly (not just "tests pass").
- [ ] Push (pre-push hook runs the full gate). Then update the resume-note memory with Slice A status + remaining slices (B/C/D).

---

## Not in Slice A (later slices)

- **Slice B:** `seva_signups` schema + `/family/seva` browse + sign-up + cancel + `/api/setu/seva/*` + capacity enforcement + canAccessRoute `/api/setu/seva/*`.
- **Slice C:** confirmation + hours accrual (roster view, confirm API, denormalized `sevaYear`, family yearly-total query, signups indexes).
- **Slice D:** dashboard "Seva hours" card + reminder, compliance report, welcome family-detail hours, polished requirement-config UX.
