# Seva Hours — Slice C (Confirmation + hours accrual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin/welcome-team open an opportunity's **sign-up roster** at `/welcome/seva/[oppId]`, mark each sign-up **completed** (accept/adjust the awarded hours) or **no-show** (0 hrs), and the confirmed hours then **accrue** to the family's yearly seva total. The family's `/family/seva` page stops showing a Sign-up button for an already-resolved sign-up and instead shows its **Completed · X hrs** state, plus the family's running **X of {target}** earned-hours total.

**Architecture:** A confirmer-facing `POST /api/welcome/seva/signups/[signupId]/confirm` writes `status` + `hoursAwarded` + `confirmedAt`/`confirmedBy` onto the existing `seva_signups/{oppId__fid}` doc (built in Slice B). A `GET /api/welcome/seva/opportunities/[oppId]/signups` roster endpoint + a `getOpportunityRoster(oppId)` reader join each sign-up to its family name (and credited member name) via the already-cached `getFamilyByFid`. The themed `/welcome/seva/[oppId]` roster page drives confirmation. On the family side, `getFamilySevaView` gains a computed `hoursEarned` (Σ completed `hoursAwarded` this year) and a closed-opportunity join fix so resolved sign-ups still render their opportunity summary; `seva-browser.tsx` learns the `completed`/`no-show` states.

**Tech Stack / strict flags / conventions:** identical to Slices A & B — see `docs/superpowers/plans/2026-06-05-seva-hours-slice-a.md` (**"Design system / UX requirements"** + **"Mobile-app readiness"**) and `docs/superpowers/plans/2026-06-06-seva-hours-slice-b.md`, both of which apply verbatim. Spec: `docs/superpowers/specs/2026-06-05-seva-hours-design.md`.

## Cross-cutting (REPEAT of the hard rules — do not skip)
- **Mobile-app readiness:** EVERY new `/api/welcome/seva/*` and `/api/setu/seva/*` handler derives identity from `readSessionFromHeaders(req)` (works for the web `__session` cookie AND a Bearer-token mobile client). **NEVER `getCurrentFamily()` / `cookies()` inside an API handler.** (Server *pages* — `/welcome/seva/[oppId]/page.tsx` — are web rendering and MAY read `cookies()` for the defensive role re-check, mirroring `app/welcome/family/[fid]/page.tsx`.) Responses: JSON, ISO-string dates (`serializeOpportunity` / `serializeSignup` / the roster serializer), numbers as numbers, consistent `{ ... }` / `{ error }` envelope.
- **Modern on-theme UX:** Cool-Mist tokens, `CspRoot` / `.csp` scoping, real mobile (`block md:hidden`) + desktop (`hidden md:block`) layouts, designer pass. Mirror the existing `SevaManager` (`apps/portal/src/features/admin/seva/seva-manager.tsx`), `SevaBrowser` (`apps/portal/src/features/setu/seva/seva-browser.tsx`), and `app/welcome/family/[fid]/page.tsx`.
- **Role checks via helpers:** `isWelcomeTeam(session)` (NEVER strict-equality on `role`). Admin inherits welcome-team.
- **`exactOptionalPropertyTypes`:** never assign `undefined` to an optional property; conditionally spread / omit instead.

## Index strategy — NO new composite index in Slice C (deliberate deviation from the spec)
The umbrella spec proposed `seva_signups (oppId, status)` and `(fid, sevaYear, status)` composite indexes. **Slice C does not add them**, because every query it issues is **single-field** and reduces in memory:
- Roster: `listSignupsForOpp(oppId)` = `where('oppId','==',oppId)` (no `orderBy`) → Firestore automatic single-field index; sort/group by status happens in memory.
- Family earned-hours: reuses `listFamilySignups(fid)` = `where('fid','==',fid)` → automatic single-field index; the `status==='completed' && sevaYear===year` filter + sum happen in memory (a family has only a handful of sign-ups).

This is strictly safer (no Firestore index deploy, zero `FAILED_PRECONDITION` risk, no brush with the prod-index `--force` hazard) and correct at this data scale. If a future server-side aggregate query is written (e.g. Slice D compliance querying `seva_signups` across all families), add the matching composite index **in that slice, in the same commit as the query** (per the `feedback_firestore_collection_group_index` rule) and deploy to **UAT only**, never `--force` prod.

## canAccessRoute — already covered, no change
Both new endpoints live under `/api/welcome/seva/` (`/api/welcome/seva/opportunities/[oppId]/signups` and `/api/welcome/seva/signups/[signupId]/confirm`), which the existing rule `if (pathname === '/api/welcome/seva' || pathname.startsWith('/api/welcome/seva/')) return isWelcomeTeam(claims);` (`can-access-route.ts:159`) already gates. The roster **page** `/welcome/seva/[oppId]` is covered by `/welcome/*` → `isWelcomeTeam`. **No `can-access-route.ts` change in Slice C.** (Add a confirming test anyway — Task C3.)

---

## File structure

**Create:**
- `apps/portal/src/features/setu/seva/get-opportunity-roster.ts` — `getOpportunityRoster(oppId)` (joins family + credited-member names) + `RosterRow` / `RosterData` types via shared shape.
- `apps/portal/src/app/api/welcome/seva/opportunities/[oppId]/signups/route.ts` — GET roster.
- `apps/portal/src/app/api/welcome/seva/signups/[signupId]/confirm/route.ts` — POST confirm.
- `apps/portal/src/features/admin/seva/roster-client.ts` — client wrappers (`fetchRoster`, `confirmSignup`) + serialized types.
- `apps/portal/src/features/admin/seva/roster-manager.tsx` — themed confirmer UI.
- `apps/portal/src/app/welcome/seva/[oppId]/page.tsx` — server page (defensive role check + mobile/desktop blocks).
- Tests alongside each.

**Modify:**
- `packages/shared-domain/src/setu/schemas/seva.ts` (+ test) — add `ConfirmSevaSignupSchema` + type.
- `apps/portal/src/features/setu/seva/get-family-seva-view.ts` (+ test) — add `hoursEarned`; fix the closed-opportunity join.
- `apps/portal/src/features/setu/seva/seva-browser-client.ts` — surface `hoursEarned` from the opportunities response.
- `apps/portal/src/features/setu/seva/seva-browser.tsx` (+ test) — handle `completed` / `no-show` states; show `X of {target}` earned hours.
- `apps/portal/src/features/admin/seva/seva-manager.tsx` (+ test) — add a "View roster" link on each opportunity card.

---

## Task C1: Confirm schema (shared-domain)

**Files:** modify `packages/shared-domain/src/setu/schemas/seva.ts`; create `packages/shared-domain/src/setu/schemas/__tests__/seva-confirm.test.ts`.

- [ ] **Step 1 — failing test** (`seva-confirm.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { ConfirmSevaSignupSchema } from '../seva';

describe('ConfirmSevaSignupSchema', () => {
  it('accepts completed with explicit hours', () => {
    const p = ConfirmSevaSignupSchema.parse({ status: 'completed', hoursAwarded: 4 });
    expect(p.status).toBe('completed');
    expect(p.hoursAwarded).toBe(4);
  });
  it('accepts completed with no hours (confirmer accepts default later)', () => {
    const p = ConfirmSevaSignupSchema.parse({ status: 'completed' });
    expect(p.hoursAwarded).toBeUndefined();
  });
  it('accepts no-show', () => {
    expect(ConfirmSevaSignupSchema.parse({ status: 'no-show' }).status).toBe('no-show');
  });
  it('rejects signed-up / cancelled as a confirm target', () => {
    expect(ConfirmSevaSignupSchema.safeParse({ status: 'signed-up' }).success).toBe(false);
    expect(ConfirmSevaSignupSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });
  it('rejects negative hours', () => {
    expect(ConfirmSevaSignupSchema.safeParse({ status: 'completed', hoursAwarded: -1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2 — run, confirm fail:** `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/seva-confirm.test.ts`

- [ ] **Step 3 — implement** (append to `seva.ts`, after `CreateSevaSignupSchema`):
```ts
// Confirmation: a roster manager marks a sign-up completed (hours accrue) or
// no-show (0 hrs). hoursAwarded is optional — when omitted on 'completed', the
// route falls back to the opportunity's defaultHours.
export const ConfirmSevaSignupSchema = z.object({
  status: z.enum(['completed', 'no-show']),
  hoursAwarded: z.number().nonnegative().max(100).optional(),
});
export type ConfirmSevaSignupInput = z.infer<typeof ConfirmSevaSignupSchema>;
```
(The barrel already does `export * from './schemas/seva'`, so no barrel change.)

- [ ] **Step 4 — run the seva schema tests + full shared-domain suite + `tsc --noEmit` → green. Step 5 — commit:** `feat(seva): confirm-signup schema`.

---

## Task C2: Opportunity roster reader (family + member name join)

**Files:** create `apps/portal/src/features/setu/seva/get-opportunity-roster.ts` + `__tests__/get-opportunity-roster.test.ts`.

This reader powers the roster GET endpoint and the roster page. It joins each non-cancelled sign-up to its family name (via the already-cached `getFamilyByFid`) and, when a member is credited, that member's name. Rows sort by status priority (`signed-up` first, then `completed`, then `no-show`) and then `signedUpAt` ascending.

- [ ] **Step 1 — failing test:** mock `./get-opportunities` (`getOpportunity`, `serializeOpportunity` as identity passthrough), `./get-signups` (`listSignupsForOpp`), and `@/features/setu/members/get-family-by-fid` (`getFamilyByFid`). Assert:
  - returns `null` when `getOpportunity` returns null.
  - excludes `cancelled` sign-ups from `rows`.
  - resolves `familyName` from `getFamilyByFid(fid).family.name`; falls back to the `fid` string when the family lookup is null.
  - resolves `memberName` from the matching member when `mid` is set; `null` when `mid` is null OR the member is no longer in the family (graceful degrade).
  - ISO-stringifies `signedUpAt`; passes through `status` + `hoursAwarded`.
  - sorts `signed-up` before `completed` before `no-show`.

Example test skeleton:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../get-opportunities', () => ({
  getOpportunity: vi.fn(),
  serializeOpportunity: (o: unknown) => o,
}));
vi.mock('../get-signups', () => ({ listSignupsForOpp: vi.fn() }));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: vi.fn() }));

import { getOpportunityRoster } from '../get-opportunity-roster';
import { getOpportunity } from '../get-opportunities';
import { listSignupsForOpp } from '../get-signups';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

const opp = { oppId: 'o1', title: 'Hall setup', defaultHours: 3, sevaYear: '2025-26', status: 'open' };
function signup(over: Record<string, unknown>) {
  return {
    signupId: 'o1__F1', oppId: 'o1', fid: 'F1', mid: null, sevaYear: '2025-26',
    status: 'signed-up', hoursAwarded: 0, signedUpAt: new Date('2026-01-02T00:00:00Z'),
    signedUpByMid: 'F1-01', confirmedAt: null, confirmedBy: null, ...over,
  };
}
function family(fid: string, name: string, members: { mid: string; firstName: string; lastName: string }[] = []) {
  return { family: { fid, name, location: '', legacyFid: null, createdAt: new Date(), managers: [], searchKeys: [] }, members };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOpportunity).mockResolvedValue(opp as never);
});

describe('getOpportunityRoster', () => {
  it('returns null for a missing opportunity', async () => {
    vi.mocked(getOpportunity).mockResolvedValue(null);
    expect(await getOpportunityRoster('nope')).toBeNull();
  });

  it('joins family + member names, excludes cancelled, sorts by status', async () => {
    vi.mocked(listSignupsForOpp).mockResolvedValue([
      signup({ signupId: 'o1__F2', fid: 'F2', status: 'completed', hoursAwarded: 3 }),
      signup({ signupId: 'o1__F1', fid: 'F1', mid: 'F1-02' }),
      signup({ signupId: 'o1__F3', fid: 'F3', status: 'cancelled' }),
    ] as never);
    vi.mocked(getFamilyByFid).mockImplementation(async (fid: string) => {
      if (fid === 'F1') return family('F1', 'Sharma', [{ mid: 'F1-02', firstName: 'Ravi', lastName: 'Sharma' }]) as never;
      if (fid === 'F2') return family('F2', 'Patel') as never;
      return null;
    });
    const res = await getOpportunityRoster('o1');
    expect(res).not.toBeNull();
    expect(res!.rows.map((r) => r.signupId)).toEqual(['o1__F1', 'o1__F2']); // cancelled gone; signed-up before completed
    expect(res!.rows[0]).toMatchObject({ fid: 'F1', familyName: 'Sharma', memberName: 'Ravi Sharma', status: 'signed-up' });
    expect(res!.rows[1]).toMatchObject({ fid: 'F2', familyName: 'Patel', memberName: null, hoursAwarded: 3 });
    expect(typeof res!.rows[0].signedUpAt).toBe('string');
  });

  it('falls back to fid when the family is missing and degrades a stale member credit', async () => {
    vi.mocked(listSignupsForOpp).mockResolvedValue([
      signup({ signupId: 'o1__F9', fid: 'F9', mid: 'F9-09' }),
    ] as never);
    vi.mocked(getFamilyByFid).mockResolvedValue(null as never);
    const res = await getOpportunityRoster('o1');
    expect(res!.rows[0]).toMatchObject({ familyName: 'F9', memberName: null });
  });
});
```

- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement** (`get-opportunity-roster.ts`):
```ts
import type { SevaSignupStatusType } from '@cmt/shared-domain';
import { getOpportunity, serializeOpportunity } from './get-opportunities';
import { listSignupsForOpp } from './get-signups';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

export interface RosterRow {
  signupId: string;
  fid: string;
  familyName: string;
  mid: string | null;
  memberName: string | null;
  status: SevaSignupStatusType;
  hoursAwarded: number;
  signedUpAt: string;
}

export interface RosterData {
  opportunity: ReturnType<typeof serializeOpportunity>;
  rows: RosterRow[];
}

// Confirmer-facing sort: outstanding sign-ups first so they're easy to action.
const STATUS_ORDER: Record<string, number> = { 'signed-up': 0, completed: 1, 'no-show': 2, cancelled: 3 };

export async function getOpportunityRoster(oppId: string): Promise<RosterData | null> {
  const opp = await getOpportunity(oppId);
  if (!opp) return null;

  const signups = (await listSignupsForOpp(oppId)).filter((s) => s.status !== 'cancelled');

  // Resolve each distinct family once (getFamilyByFid is 'use cache').
  const uniqueFids = [...new Set(signups.map((s) => s.fid))];
  const families = await Promise.all(uniqueFids.map((fid) => getFamilyByFid(fid)));
  const familyByFid = new Map(uniqueFids.map((fid, i) => [fid, families[i] ?? null]));

  const rows: RosterRow[] = signups
    .slice()
    .sort((a, b) => {
      const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      return s !== 0 ? s : a.signedUpAt.getTime() - b.signedUpAt.getTime();
    })
    .map((s) => {
      const fam = familyByFid.get(s.fid) ?? null;
      const member = s.mid && fam ? (fam.members.find((m) => m.mid === s.mid) ?? null) : null;
      return {
        signupId: s.signupId,
        fid: s.fid,
        familyName: fam?.family.name ?? s.fid,
        mid: s.mid,
        memberName: member ? `${member.firstName} ${member.lastName}`.trim() : null,
        status: s.status,
        hoursAwarded: s.hoursAwarded,
        signedUpAt: s.signedUpAt.toISOString(),
      };
    });

  return { opportunity: serializeOpportunity(opp), rows };
}
```

- [ ] **Step 4 — run + `tsc --noEmit` → green. Step 5 — commit:** `feat(seva): opportunity roster reader (family + member join)`.

---

## Task C3: Roster GET + confirm POST endpoints (mobile-ready)

**Files:** create `apps/portal/src/app/api/welcome/seva/opportunities/[oppId]/signups/route.ts` + `__tests__`, `apps/portal/src/app/api/welcome/seva/signups/[signupId]/confirm/route.ts` + `__tests__`. Also add a confirming test to `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts` (NO production change — the existing `/api/welcome/seva/*` rule covers both paths).

Mobile-ready: auth via `readSessionFromHeaders`; role via `isWelcomeTeam`. Mirror `app/api/welcome/seva/opportunities/[oppId]/route.ts`.

- [ ] **Step 1 — failing tests.**

Roster GET (`opportunities/[oppId]/signups/__tests__/route.test.ts`) — mock `@/features/setu/seva/get-opportunity-roster` (`getOpportunityRoster`). Cases: 401 no session; 403 non-welcome (e.g. `family-member`); 404 when roster is null; 200 returns `{ opportunity, rows }` for welcome-team and for admin (admin inherits welcome-team). Request helper sets `x-portal-role` / `x-portal-uid` headers (mirror the Slice B `signups/__tests__/route.test.ts` `req()` helper). Params are passed as `ctx = { params: Promise.resolve({ oppId: 'o1' }) }`.

Confirm POST (`signups/[signupId]/confirm/__tests__/route.test.ts`) — mock `@/features/setu/seva/get-signups` (`getSignup`), `@/features/setu/seva/get-opportunities` (`getOpportunity`), and `@cmt/firebase-shared/admin/firestore` (`portalFirestore` set + `FieldValue.serverTimestamp`). Cases:
  - 401 no session; 403 non-welcome;
  - 400 bad body (`{ status: 'signed-up' }` or `{}`);
  - 404 when `getSignup` → null;
  - 409 `not-confirmable` when the existing sign-up is `cancelled`;
  - 200 `completed` with explicit `hoursAwarded: 5` → writes `{ status:'completed', hoursAwarded:5, confirmedBy:<uid> }` (assert `mockSet` called with `expect.objectContaining`), `confirmedAt` is the server-timestamp sentinel;
  - 200 `completed` with NO hours → falls back to `getOpportunity(oppId).defaultHours` (mock opp `defaultHours: 3`) → writes `hoursAwarded: 3`;
  - 200 `no-show` → writes `hoursAwarded: 0` (and does NOT call `getOpportunity`).

canAccessRoute test (add to existing suite):
```ts
it('gates the roster + confirm paths to welcome-team (admin inherits)', () => {
  expect(canAccessRoute(welcomeTeam, '/api/welcome/seva/opportunities/o1/signups', 'GET')).toBe(true);
  expect(canAccessRoute(admin, '/api/welcome/seva/signups/o1__FAM/confirm', 'POST')).toBe(true);
  expect(canAccessRoute(member, '/api/welcome/seva/signups/o1__FAM/confirm', 'POST')).toBe(false);
});
```
(Use whatever `welcomeTeam` / `admin` / `member` claim fixtures the existing test file already defines.)

- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement.**

Roster GET (`opportunities/[oppId]/signups/route.ts`):
```ts
import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getOpportunityRoster } from '@/features/setu/seva/get-opportunity-roster';

type RouteContext = { params: Promise<{ oppId: string }> };

export async function GET(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { oppId } = await ctx.params;
  const roster = await getOpportunityRoster(oppId);
  if (!roster) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json(roster);
}
```

Confirm POST (`signups/[signupId]/confirm/route.ts`):
```ts
import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isWelcomeTeam, ConfirmSevaSignupSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSignup } from '@/features/setu/seva/get-signups';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';

type RouteContext = { params: Promise<{ signupId: string }> };

export async function POST(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { signupId } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = ConfirmSevaSignupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });

  const existing = await getSignup(signupId);
  if (!existing) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  // A family-cancelled sign-up cannot be confirmed (they withdrew). Any other
  // state — signed-up, or a prior completed/no-show being re-adjusted — is fine.
  if (existing.status === 'cancelled') return NextResponse.json({ error: 'not-confirmable' }, { status: 409 });

  const { status } = parsed.data;
  let hoursAwarded = 0;
  if (status === 'completed') {
    if (parsed.data.hoursAwarded != null) {
      hoursAwarded = parsed.data.hoursAwarded;
    } else {
      const opp = await getOpportunity(existing.oppId);
      hoursAwarded = opp?.defaultHours ?? 0;
    }
  }

  await portalFirestore().collection('seva_signups').doc(signupId).set(
    { status, hoursAwarded, confirmedAt: FieldValue.serverTimestamp(), confirmedBy: session.uid },
    { merge: true },
  );
  return NextResponse.json({ ok: true, status, hoursAwarded });
}
```

- [ ] **Step 4 — run both route suites + the canAccessRoute suite + `tsc --noEmit` → green. Step 5 — commit:** `feat(seva): roster GET + confirm-signup APIs`.

---

## Task C4: Roster page + confirmer UI (themed, responsive, mobile-ready)

**Files:** create `apps/portal/src/features/admin/seva/roster-client.ts`, `apps/portal/src/features/admin/seva/roster-manager.tsx`, `__tests__/roster-manager.test.tsx`, `apps/portal/src/app/welcome/seva/[oppId]/page.tsx`. Modify `apps/portal/src/features/admin/seva/seva-manager.tsx` (+ its test) to add a per-opportunity "View roster" link.

Read `SevaManager`, `SevaBrowser`, and `app/welcome/family/[fid]/page.tsx` first for the exact tokens, the `block md:hidden` / `hidden md:block` split, the defensive role re-check, and the no-nested-component render-helper discipline.

- [ ] **Step 1 — client wrappers** (`roster-client.ts`):
```ts
// Client-safe wrappers around the welcome roster + confirm routes. The route
// handlers use firebase-admin (server-only); call THESE from the UI and mock
// THESE in component tests. Mirrors features/admin/seva/opportunities-client.ts.
import type { SerializedOpportunity } from './opportunities-client';

export interface RosterRow {
  signupId: string;
  fid: string;
  familyName: string;
  mid: string | null;
  memberName: string | null;
  status: 'signed-up' | 'completed' | 'no-show';
  hoursAwarded: number;
  signedUpAt: string;
}

export interface RosterData {
  opportunity: SerializedOpportunity;
  rows: RosterRow[];
}

/** GET the roster for one opportunity. Returns null on error/404. */
export async function fetchRoster(oppId: string): Promise<RosterData | null> {
  const res = await fetch(`/api/welcome/seva/opportunities/${oppId}/signups`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as RosterData | null;
}

/** POST a confirmation. Omit hoursAwarded to let the server use the opp default. */
export async function confirmSignup(
  signupId: string,
  body: { status: 'completed' | 'no-show'; hoursAwarded?: number },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/welcome/seva/signups/${signupId}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(data.error ? { error: data.error } : {}) };
}
```
Note: `confirmSignup`'s caller must OMIT `hoursAwarded` from the object when it should default — never pass `hoursAwarded: undefined` (exactOptionalPropertyTypes). Build the body conditionally.

- [ ] **Step 2 — component test** (`roster-manager.test.tsx`) — mock `@cmt/ui` (`SetuIcon` as stub glyphs, `toast`) and `../roster-client` (`fetchRoster`, `confirmSignup`). Assert:
  - renders the opportunity title + each row's `familyName` (and `memberName` when present, e.g. "For Ravi Sharma");
  - a `signed-up` row shows a "Mark completed" action and a "No-show" action;
  - clicking "Mark completed" reveals an hours input prefilled with the opportunity `defaultHours`, and confirming calls `confirmSignup(signupId, { status: 'completed', hoursAwarded: <number> })`;
  - clicking "No-show" calls `confirmSignup(signupId, { status: 'no-show' })`;
  - a `completed` row shows "Completed · {hours} hrs" and an "Edit" affordance (re-opens the hours control);
  - after a successful confirm the manager re-reads via `fetchRoster` (assert it's called again) and fires a success toast;
  - an empty roster (`rows: []`) shows a friendly "No sign-ups yet" state.

- [ ] **Step 3 — implement `RosterManager`** (`roster-manager.tsx`, `'use client'`). Props: `{ initial: RosterData }`. Structure (themed, reuses the `SevaManager` style constants — copy the small style objects locally; do NOT cross-import a component's internals):
  - **Header:** eyebrow "Seva roster", `<h1>` = opportunity title, a metadata line (Toronto `fmtDate(opportunity.date)` · `{defaultHours} hrs` · `{location}` · capacity), and a count summary ("{n} signed up · {m} completed").
  - **Rows list:** one `card` per row → family name (mono-ish, bold), credited member ("For {memberName}") when present, a status pill, and an action area:
    - `signed-up`: **Mark completed** (primary) → opens an inline hours `<input type="number">` prefilled with `opportunity.defaultHours` + a **Confirm** button → `confirmSignup(signupId, { status:'completed', hoursAwarded:Number(hours) })`; and a **No-show** (ghost) → `confirmSignup(signupId, { status:'no-show' })`.
    - `completed`: a "Completed · {hoursAwarded} hrs" accent pill + an **Edit** (secondary) that re-opens the hours control (defaulting to the current `hoursAwarded`).
    - `no-show`: a muted "No-show" pill + a **Mark completed** option (lets a confirmer correct a mistake).
  - State: `rows` in `useState` (seed from `initial.rows`); one row's editor open at a time (`editingId` + `hoursDraft`); a `pendingId` double-click guard (mirror `SevaBrowser`). After any successful `confirmSignup`, call `fetchRoster(oppId)` and re-seed `rows` (so accrued hours + status reflect the server), then `toast.success`. On error, map `not-confirmable` → "This sign-up was cancelled by the family" else a generic toast.
  - **No nested component declarations** — use a `renderRowAction(row)` helper called as a function (the focus-stealing remount rule).
  - Mobile-first: the row layout must wrap cleanly at ~375px (stack the action area under the name); verify with the `block md:hidden` page wrapper below.

- [ ] **Step 4 — implement the page** (`app/welcome/seva/[oppId]/page.tsx`) — mirror `app/welcome/family/[fid]/page.tsx`: a thin `<Suspense>` wrapper + a body that does the **defensive welcome-team re-check** (`cookies()` → `verifyPortalSessionCookie` → `isWelcomeTeam`), `notFound()` when the roster is null, and renders `RosterManager` inside both a mobile (`block md:hidden`, `CspRoot` + padding + a back link to `/welcome/seva`) and desktop (`hidden md:block`, capped width + back link) block:
```tsx
import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SetuIcon } from '@cmt/ui';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { getOpportunityRoster } from '@/features/setu/seva/get-opportunity-roster';
import { RosterManager } from '@/features/admin/seva/roster-manager';

export const metadata = { title: 'Seva roster — CMT Portal' };

export default function WelcomeSevaRosterPage({ params }: { params: Promise<{ oppId: string }> }) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading roster…</div>}>
      <RosterPageBody params={params} />
    </Suspense>
  );
}

export async function RosterPageBody({ params }: { params: Promise<{ oppId: string }> }) {
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  if (!raw || !isWelcomeTeam(raw as unknown as WithRole)) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { oppId } = await params;
  const roster = await getOpportunityRoster(oppId);
  if (!roster) notFound();

  const manager = <RosterManager initial={roster} />;
  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/welcome/seva" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Seva roster</span>
              <div style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 96px' }}>{manager}</div>
          </div>
        </CspRoot>
      </div>
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        <Link href="/welcome/seva" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 16 }}>
          <SetuIcon.back /> Back to opportunities
        </Link>
        {manager}
      </div>
    </>
  );
}
```

- [ ] **Step 5 — add the "View roster" link in `SevaManager`** — on each non-editing opportunity card's action row (next to Edit / Close), add a `<Link href={`/welcome/seva/${o.oppId}`}>` styled as a `btn btn--s` ("View roster"). Update the `seva-manager.test.tsx` to assert the link renders with the right href for an opportunity. (Use `next/link`; it renders an `<a href>` in jsdom.)

- [ ] **Step 6 — run the roster-manager + seva-manager tests → PASS; `tsc --noEmit` → clean; `pnpm lint` clean.**

- [ ] **Step 7 — designer pass:** dispatch `oh-my-claudecode:designer` (opus) to elevate `roster-manager.tsx` visuals (row cards, status pills, the inline hours-confirm affordance, completed/no-show states, count summary, empty state) against the tokens and make the mobile experience excellent — WITHOUT changing behavior or breaking the tests. Re-run test + typecheck + lint.

- [ ] **Step 8 — commit:** `feat(seva): opportunity roster page + confirmer UI`.

---

## Task C5: Family carry-forward — earned hours + resolved-signup states

**Files:** modify `apps/portal/src/features/setu/seva/get-family-seva-view.ts` (+ test), `apps/portal/src/features/setu/seva/seva-browser-client.ts`, `apps/portal/src/features/setu/seva/seva-browser.tsx` (+ test), `apps/portal/src/app/family/seva/page.tsx`.

This closes the Slice B carry-forward: a `completed` / `no-show` sign-up must NOT render a Sign-up button (it would 409 `already-resolved`), and the family should see hours accrue.

- [ ] **Step 1 — `getFamilySevaView` test additions** — extend `__tests__/get-family-seva-view.test.ts`:
  - add `hoursEarned` to the returned shape: Σ `hoursAwarded` over the family's `completed` sign-ups in the current year (e.g. a completed signup with `hoursAwarded:4` and a `no-show` with `hoursAwarded:0` ⇒ `hoursEarned === 4`).
  - the **closed-opportunity join fix**: a `completed` sign-up whose opportunity is now `closed` (so absent from the open-only browse list) still gets its `opportunity` summary in `mySignups` (NOT null). (Set up the mock so `listOpportunities({ sevaYear })` — all-statuses, no `status` filter — returns the closed opp, while `listOpportunities({ sevaYear, status:'open' })` returns only the open ones.)
  - when `currentSevaYear` is null → `{ ..., hoursEarned: 0 }`.

- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement** — update `getFamilySevaView`:
```ts
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from './get-opportunities';
import { listFamilySignups, listSignupsForOpp, serializeSignup, isActiveSignup } from './get-signups';

export async function getFamilySevaView(fid: string) {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return { currentSevaYear: null, hoursPerYear, hoursEarned: 0, opportunities: [], mySignups: [] };
  }

  // openOpps drives the browse list; allOpps (incl. closed) backs the
  // my-signups join so a resolved sign-up on a since-closed opp still shows
  // its summary.
  const [openOpps, allOpps, mySignupsAll] = await Promise.all([
    listOpportunities({ sevaYear: currentSevaYear, status: 'open' }),
    listOpportunities({ sevaYear: currentSevaYear }),
    listFamilySignups(fid),
  ]);

  const activeByOpp = new Map<string, number>();
  await Promise.all(
    openOpps
      .filter((o) => o.capacity != null)
      .map(async (o) => {
        const signups = await listSignupsForOpp(o.oppId);
        activeByOpp.set(o.oppId, signups.filter(isActiveSignup).length);
      }),
  );

  const myThisYear = mySignupsAll.filter((s) => s.sevaYear === currentSevaYear);
  const myByOpp = new Map(myThisYear.map((s) => [s.oppId, s]));

  const opportunities = openOpps.map((o) => {
    const mine = myByOpp.get(o.oppId);
    const spotsLeft = o.capacity != null ? Math.max(0, o.capacity - (activeByOpp.get(o.oppId) ?? 0)) : null;
    return { ...serializeOpportunity(o), mySignupStatus: mine ? mine.status : null, spotsLeft };
  });

  const oppById = new Map(allOpps.map((o) => [o.oppId, o]));
  const mySignups = myThisYear
    .filter((s) => s.status !== 'cancelled')
    .map((s) => {
      const opp = oppById.get(s.oppId);
      return { ...serializeSignup(s), opportunity: opp ? serializeOpportunity(opp) : null };
    });

  const hoursEarned = myThisYear
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + (s.hoursAwarded ?? 0), 0);

  return { currentSevaYear, hoursPerYear, hoursEarned, opportunities, mySignups };
}
```

- [ ] **Step 4 — thread `hoursEarned` through the client + page.**
  - `seva-browser-client.ts` → `fetchOpportunities` return type gains `hoursEarned: number`; read `data.hoursEarned ?? 0`; default `0` in the error branch.
  - `app/family/seva/page.tsx` → pass `hoursEarned={view.hoursEarned}` to `<SevaBrowser>` (both wrapper blocks already share the one `browser` element — just add the prop once).

- [ ] **Step 5 — `seva-browser.tsx` test additions** — extend `__tests__/seva-browser.test.tsx`:
  - the goal band shows earned progress: with `hoursEarned={6}` and `hoursPerYear={20}` it renders "6 of 20" (keep the existing `{hoursPerYear} hours` assertion working by adjusting it to the new copy — see Step 6).
  - an opportunity with `mySignupStatus:'completed'` renders a "Completed" indicator and **no "Sign up" button** (query that the sign-up button is absent for that card).
  - a `completed` entry appears in "My sign-ups" showing its `hoursAwarded` (e.g. "4 hrs") and has **no Cancel button**.
  - a `signed-up` entry still shows Cancel (unchanged).

- [ ] **Step 6 — implement `seva-browser.tsx` changes** (behavior-focused; the designer already owns the polish, keep edits minimal + on-theme):
  - Accept a new prop `hoursEarned: number` (add to `SevaBrowserProps`); `app/family/seva/page.tsx` passes it.
  - **Goal band copy:** replace the single goal line with progress: render the earned total against the target, e.g. a line that contains the contiguous text `"{hoursEarned} of {hoursPerYear}"` plus "hours of seva this year". Keep it a simple text treatment (the full progress bar is Slice D) — but the `{hoursEarned} of {hoursPerYear}` substring MUST be a single contiguous text node so the test can match it. Update the existing goal-band test expectation accordingly.
  - **`renderOppAction(o)`** — add, BEFORE the `isSignedUp` branch, a resolved-state branch:
    ```tsx
    if (o.mySignupStatus === 'completed' || o.mySignupStatus === 'no-show') {
      const done = o.mySignupStatus === 'completed';
      return (
        <span className="pill" style={{ background: done ? 'var(--accentSoft)' : 'var(--surface2)', color: done ? 'var(--accentDeep)' : 'var(--muted)', fontWeight: 600, fontSize: 12, padding: '6px 12px' }}>
          {done ? <SetuIcon.check width={13} height={13} /> : null} {done ? 'Completed' : 'Marked absent'}
        </span>
      );
    }
    ```
    (This prevents the completed→Sign-up→409 bug.) Keep `isSignedUp` / `isFull` / default branches as they are.
  - **My sign-ups:** split the list into the active (`status === 'signed-up'`, with Cancel) ones and the completed (`status === 'completed'`) ones. Render completed rows with a check glyph and "{hoursAwarded} hrs" and NO Cancel button. (no-show rows may be omitted from My-signups, or shown muted — omitting is fine.) Replace the `const activeSignups = mySignups.filter((s) => s.status === 'signed-up')` line with the two derived lists and render both groups under the "My sign-ups" `SectionLabel` (active first). Keep the existing empty-state when BOTH are empty.

- [ ] **Step 7 — run `seva-browser` + `get-family-seva-view` tests → PASS; `tsc --noEmit` → clean; `pnpm lint` clean.**
- [ ] **Step 8 — designer touch-up (optional, light):** if the new completed/earned states need polish, a short `oh-my-claudecode:designer` (opus) pass on the goal band + completed rows only — no behavior change. Re-run tests.
- [ ] **Step 9 — commit:** `feat(seva): family earned-hours + completed/no-show states on /family/seva`.

---

## Slice C verification (before done)

- [ ] `tsc --noEmit` (portal + shared-domain) → 0 errors; `pnpm lint` clean; full vitest suites green.
- [ ] **Mobile-app readiness:** every new `/api/welcome/seva/*` handler uses `readSessionFromHeaders` + `isWelcomeTeam` (grep to confirm no `getCurrentFamily`/`cookies` inside handlers); ISO-string dates; consistent envelope. The roster **page** may use `cookies()` (web render) — that's expected.
- [ ] **No new Firestore index** was added (single-field queries only — see "Index strategy"). Confirm no handler/reader introduced a two-field `where`/`orderBy` on `seva_signups`.
- [ ] Final review pass (spec-compliance + code-quality, Opus).
- [ ] **Mock-free UAT walkthrough:** as welcome-team → `/welcome/seva` → open an opportunity's roster → mark a family **completed** (accept default hours, then edit hours) and another **no-show** → confirm the roster reflects it. Then as that family → `/family/seva` (mobile + desktop) → the completed opportunity shows "Completed" (no Sign-up button) and the goal band shows "{earned} of {target}". Report UAT status explicitly (note: OTP sign-in may block the agent from doing this live — flag it for CMT Developer if so).
- [ ] Push (full gate). Update resume-note memory: Slice C shipped; D remains.

## Not in Slice C (Slice D)
- Dashboard "Seva hours · X of {target}" progress card + a reminder when short, on `/family`.
- `GET /api/welcome/seva/compliance` + `/welcome/seva/compliance` report (families vs target). **If** that report queries `seva_signups` server-side across families, add the matching composite index in Slice D, same commit, UAT-only.
- Seva hours on the welcome family-detail page (`/welcome/family/[fid]`).
- Admin requirement-config editing polish (already functional via `SevaManager`).
