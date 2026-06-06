# Seva Hours — Slice B (Family browse + sign-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A family can browse open seva opportunities at `/family/seva`, **sign up** (optionally crediting a member), and **cancel** their sign-up. Hours do NOT accrue yet (confirmation + accrual is Slice C).

**Architecture:** New `seva_signups` collection (deterministic id `${oppId}__${fid}`, one per family per opportunity). Family-facing `/api/setu/seva/*` routes (mobile-ready, gated `isSetuFamily`). A shared `getFamilySevaView(fid)` join (open opportunities + this family's signup status + spots-left) used by both the page and the GET endpoints. Themed `/family/seva` page.

**Tech Stack / strict flags / conventions:** identical to Slice A — see `docs/superpowers/plans/2026-06-05-seva-hours-slice-a.md`, especially its **"Design system / UX requirements"** and **"Mobile-app readiness"** sections, which apply verbatim here. Spec: `docs/superpowers/specs/2026-06-05-seva-hours-design.md`.

## Cross-cutting (REPEAT of the hard rules — do not skip)
- **Mobile-app readiness:** EVERY `/api/setu/seva/*` handler derives identity from `readSessionFromHeaders(req)` → `session.fid` / `session.mid` (works for web cookie AND Bearer-token mobile clients). **NEVER `getCurrentFamily()` / `cookies()` in an API handler.** (The `/family/seva` *page* is a server component and MAY use `getCurrentFamily()` — that's web-only rendering, fine.) Responses: JSON, ISO-string dates (use `serializeOpportunity`/`serializeSignup`), numbers as numbers, consistent `{ ... }`/`{ error }` envelope.
- **Modern on-theme UX:** Cool-Mist tokens, `CspRoot`/`.csp` scoping, real mobile (`block md:hidden`) + desktop (`hidden md:block`) layouts, designer pass. Mirror the existing family pages (`apps/portal/src/app/family/page.tsx`, `apps/portal/src/app/family/members/page.tsx`) and the Slice-A `SevaManager`.

---

## File structure

**Create:**
- (modify) `packages/shared-domain/src/setu/schemas/seva.ts` — add `SevaSignupStatus`, `SevaSignupDocSchema`, `CreateSevaSignupSchema` + types.
- `apps/portal/src/features/setu/seva/get-signups.ts` — signup readers + helpers (`listFamilySignups`, `listSignupsForOpp`, `getSignup`, `serializeSignup`, `signupDocId`, `isActiveSignup`).
- `apps/portal/src/features/setu/seva/get-family-seva-view.ts` — `getFamilySevaView(fid)`.
- `apps/portal/src/app/api/setu/seva/opportunities/route.ts` — GET (family).
- `apps/portal/src/app/api/setu/seva/my/route.ts` — GET (family signups).
- `apps/portal/src/app/api/setu/seva/signups/route.ts` — POST (sign up).
- `apps/portal/src/app/api/setu/seva/signups/[signupId]/cancel/route.ts` — POST (cancel).
- `apps/portal/src/features/setu/seva/seva-browser-client.ts` — client wrappers.
- `apps/portal/src/features/setu/seva/seva-browser.tsx` — family client UI.
- `apps/portal/src/app/family/seva/page.tsx` — server page.
- Tests alongside each.

**Modify:**
- `packages/shared-domain/src/auth/can-access-route.ts` (+ test) — `/api/setu/seva/*` → `isSetuFamily`.
- `apps/portal/src/features/family/components/desktop-sidebar.tsx` — add a `'seva'` entry to `FAMILY_NAV_ITEMS` + `/family/seva` → `'seva'` in `deriveActiveFromPathname`.
- `apps/portal/src/features/family/components/mobile-bottom-nav.tsx` — add a Seva entry.

> **Index note:** Slice B queries `seva_signups` only by SINGLE fields (`where('fid','==')`, `where('oppId','==')`, `where('sevaYear','==')`) with no `orderBy`, so they run on Firestore's automatic single-field indexes — **no composite index in Slice B.** The composite signups indexes land in Slice C/D when the roster (`oppId,status`) and yearly-total (`fid,sevaYear,status`) queries are written.

---

## Task B1: Signup schema (shared-domain)

**Files:** modify `packages/shared-domain/src/setu/schemas/seva.ts`; create `__tests__/seva-signup.test.ts` (or extend the existing `seva.test.ts`).

- [ ] **Step 1 — failing test** (new `seva-signup.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { SevaSignupDocSchema, CreateSevaSignupSchema } from '../seva';

describe('SevaSignupDocSchema', () => {
  const base = {
    signupId: 'o1__CMT-AB12CD34', oppId: 'o1', fid: 'CMT-AB12CD34', mid: null,
    sevaYear: '2025-26', status: 'signed-up' as const, hoursAwarded: 0,
    signedUpAt: new Date(), signedUpByMid: 'CMT-AB12CD34-01',
    confirmedAt: null, confirmedBy: null,
  };
  it('parses a valid signed-up record', () => {
    expect(SevaSignupDocSchema.parse(base).status).toBe('signed-up');
  });
  it('accepts a member credit + completed status with hours', () => {
    const p = SevaSignupDocSchema.parse({ ...base, mid: 'CMT-AB12CD34-02', status: 'completed', hoursAwarded: 4, confirmedAt: new Date(), confirmedBy: 'u-staff' });
    expect(p.hoursAwarded).toBe(4);
  });
  it('rejects an unknown status and negative hours', () => {
    expect(SevaSignupDocSchema.safeParse({ ...base, status: 'maybe' }).success).toBe(false);
    expect(SevaSignupDocSchema.safeParse({ ...base, hoursAwarded: -1 }).success).toBe(false);
  });
});

describe('CreateSevaSignupSchema', () => {
  it('requires oppId, defaults mid to null', () => {
    expect(CreateSevaSignupSchema.parse({ oppId: 'o1' }).mid).toBeNull();
  });
  it('keeps a provided mid', () => {
    expect(CreateSevaSignupSchema.parse({ oppId: 'o1', mid: 'CMT-AB12CD34-02' }).mid).toBe('CMT-AB12CD34-02');
  });
  it('rejects a missing oppId', () => {
    expect(CreateSevaSignupSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2 — run, confirm fail:** `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/seva-signup.test.ts`

- [ ] **Step 3 — implement** (append to `seva.ts`):
```ts
export const SevaSignupStatus = z.enum(['signed-up', 'completed', 'no-show', 'cancelled']);
export type SevaSignupStatusType = z.infer<typeof SevaSignupStatus>;

export const SevaSignupDocSchema = z.object({
  signupId: z.string().min(1),
  oppId: z.string().min(1),
  fid: z.string().min(1),
  mid: z.string().nullable(),
  sevaYear: z.string().min(1),
  status: SevaSignupStatus,
  hoursAwarded: z.number().nonnegative(),
  signedUpAt: z.date(),
  signedUpByMid: z.string().nullable(),
  confirmedAt: z.date().nullable(),
  confirmedBy: z.string().nullable(),
});
export type SevaSignupDoc = z.infer<typeof SevaSignupDocSchema>;

export const CreateSevaSignupSchema = z.object({
  oppId: z.string().min(1),
  mid: z.string().min(1).nullable().optional().default(null),
});
export type CreateSevaSignupInput = z.infer<typeof CreateSevaSignupSchema>;
```
(The barrel already does `export * from './schemas/seva'`, so no barrel change.)

- [ ] **Step 4 — run the seva tests + full shared-domain suite + typecheck → green. Step 5 — commit:** `feat(seva): seva_signups schema`.

---

## Task B2: Signup readers + helpers

**Files:** create `apps/portal/src/features/setu/seva/get-signups.ts` + `__tests__/get-signups.test.ts`.

- [ ] **Step 1 — failing test:** mock `portalFirestore` (mirror `get-opportunities.test.ts`). Assert `listFamilySignups('F')` calls `.where('fid','==','F')` and maps Timestamps→Date; `listSignupsForOpp('o1')` calls `.where('oppId','==','o1')`; `getSignup` returns null when `!exists`; `serializeSignup` ISO-stringifies `signedUpAt` and (when present) `confirmedAt`; `signupDocId('o1','F')` === `'o1__F'`; `isActiveSignup` true for signed-up/completed, false for cancelled/no-show.

- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement:**
```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { SevaSignupDoc } from '@cmt/shared-domain';

const toDate = (v: unknown): Date => (v as { toDate?: () => Date })?.toDate?.() ?? new Date(v as string);

function mapSignup(d: FirebaseFirestore.DocumentData): SevaSignupDoc {
  return {
    signupId: d['signupId'], oppId: d['oppId'], fid: d['fid'], mid: d['mid'] ?? null,
    sevaYear: d['sevaYear'], status: d['status'], hoursAwarded: d['hoursAwarded'] ?? 0,
    signedUpAt: toDate(d['signedUpAt']), signedUpByMid: d['signedUpByMid'] ?? null,
    confirmedAt: d['confirmedAt'] ? toDate(d['confirmedAt']) : null,
    confirmedBy: d['confirmedBy'] ?? null,
  };
}

export function signupDocId(oppId: string, fid: string): string { return `${oppId}__${fid}`; }

const ACTIVE_STATUSES = new Set(['signed-up', 'completed']);
export function isActiveSignup(s: { status: string }): boolean { return ACTIVE_STATUSES.has(s.status); }

export async function listFamilySignups(fid: string): Promise<SevaSignupDoc[]> {
  const snap = await portalFirestore().collection('seva_signups').where('fid', '==', fid).get();
  return snap.docs.map((doc) => mapSignup(doc.data()));
}

export async function listSignupsForOpp(oppId: string): Promise<SevaSignupDoc[]> {
  const snap = await portalFirestore().collection('seva_signups').where('oppId', '==', oppId).get();
  return snap.docs.map((doc) => mapSignup(doc.data()));
}

export async function getSignup(signupId: string): Promise<SevaSignupDoc | null> {
  const snap = await portalFirestore().collection('seva_signups').doc(signupId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data ? mapSignup(data) : null;
}

export function serializeSignup(s: SevaSignupDoc) {
  return {
    ...s,
    signedUpAt: s.signedUpAt.toISOString(),
    confirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
  };
}
```
- [ ] **Step 4 — run + typecheck → green. Step 5 — commit:** `feat(seva): signup readers + helpers`.

---

## Task B3: Family seva view (the join)

**Files:** create `apps/portal/src/features/setu/seva/get-family-seva-view.ts` + `__tests__/get-family-seva-view.test.ts`.

- [ ] **Step 1 — failing test:** mock `@/lib/seva-requirement` (`getSevaRequirement`), `./get-opportunities` (`listOpportunities`, `serializeOpportunity` identity), `./get-signups` (`listFamilySignups`, `listSignupsForOpp` unused here, `serializeSignup` identity, `isActiveSignup` real or stubbed). Assert:
  - when `currentSevaYear` is null → `{ currentSevaYear: null, opportunities: [], mySignups: [] }`.
  - opportunities get `mySignupStatus` from the family's matching signup (else null) and `spotsLeft = capacity - activeCount` (null when capacity null, floored at 0).
  - `mySignups` excludes `cancelled` and joins the opportunity summary.

- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement:**
```ts
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from './get-opportunities';
import { listFamilySignups, listSignupsForOpp, serializeSignup, isActiveSignup } from './get-signups';

export async function getFamilySevaView(fid: string) {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return { currentSevaYear: null, hoursPerYear, opportunities: [], mySignups: [] };
  }

  const [opps, mySignupsAll] = await Promise.all([
    listOpportunities({ sevaYear: currentSevaYear, status: 'open' }),
    listFamilySignups(fid),
  ]);

  // active count per opportunity (for spots-left), only for capacity-limited opps.
  const activeByOpp = new Map<string, number>();
  await Promise.all(
    opps
      .filter((o) => o.capacity != null)
      .map(async (o) => {
        const signups = await listSignupsForOpp(o.oppId);
        activeByOpp.set(o.oppId, signups.filter(isActiveSignup).length);
      }),
  );

  const myThisYear = mySignupsAll.filter((s) => s.sevaYear === currentSevaYear);
  const myByOpp = new Map(myThisYear.map((s) => [s.oppId, s]));

  const opportunities = opps.map((o) => {
    const mine = myByOpp.get(o.oppId);
    const spotsLeft = o.capacity != null ? Math.max(0, o.capacity - (activeByOpp.get(o.oppId) ?? 0)) : null;
    return { ...serializeOpportunity(o), mySignupStatus: mine ? mine.status : null, spotsLeft };
  });

  const oppById = new Map(opps.map((o) => [o.oppId, o]));
  const mySignups = myThisYear
    .filter((s) => s.status !== 'cancelled')
    .map((s) => {
      const opp = oppById.get(s.oppId);
      return { ...serializeSignup(s), opportunity: opp ? serializeOpportunity(opp) : null };
    });

  return { currentSevaYear, hoursPerYear, opportunities, mySignups };
}
```
> Known limitation (acceptable for B; note in code comment): a signup for an opportunity that has since been **closed** won't find its summary in the open-only `opps` list → `opportunity: null`; the UI renders a minimal row. Slice C/D can fetch closed opps for the my-signups join.

- [ ] **Step 4 — run + typecheck → green. Step 5 — commit:** `feat(seva): family seva view (opps + signup status + spots-left)`.

---

## Task B4: Family GET endpoints (opportunities + my)

**Files:** create `apps/portal/src/app/api/setu/seva/opportunities/route.ts` + `__tests__`, `apps/portal/src/app/api/setu/seva/my/route.ts` + `__tests__`.

Mobile-ready: auth via `readSessionFromHeaders`. Mirror `apps/portal/src/app/api/setu/programs/route.ts`.

- [ ] **Step 1 — failing tests** — mock `@/features/setu/seva/get-family-seva-view` (`getFamilySevaView`). For opportunities GET: 401 no session; 200 returns `{ opportunities, currentSevaYear, hoursPerYear }` from the view; family-member role allowed. For my GET: 401 no session; 200 returns `{ mySignups }`.
- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement** (`opportunities/route.ts`):
```ts
import { NextResponse } from 'next/server';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilySevaView } from '@/features/setu/seva/get-family-seva-view';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ opportunities: [], currentSevaYear: null, hoursPerYear: 20 });
  const view = await getFamilySevaView(session.fid);
  return NextResponse.json({ opportunities: view.opportunities, currentSevaYear: view.currentSevaYear, hoursPerYear: view.hoursPerYear });
}
```
(`my/route.ts`): same auth; `const view = await getFamilySevaView(session.fid); return NextResponse.json({ mySignups: view.mySignups });` (no-fid → `{ mySignups: [] }`).

- [ ] **Step 4 — run + typecheck → green. Step 5 — commit:** `feat(seva): family GET opportunities + my-signups APIs`.

---

## Task B5: Sign-up + cancel endpoints

**Files:** create `apps/portal/src/app/api/setu/seva/signups/route.ts` (POST) + `__tests__`, `apps/portal/src/app/api/setu/seva/signups/[signupId]/cancel/route.ts` (POST) + `__tests__`.

- [ ] **Step 1 — failing tests** (POST signups) — mock `@/features/setu/seva/get-opportunities` (`getOpportunity`), `@/features/setu/seva/get-signups` (`getSignup`, `listSignupsForOpp`, `signupDocId`, `isActiveSignup` real), `@cmt/firebase-shared/admin/firestore` (portalFirestore set + FieldValue). Cases:
  - 401 no session; 400 when `session.fid` missing; 400 bad body (no oppId);
  - 404 when opportunity missing; 409 `not-open` when opportunity `status:'closed'`;
  - 400 `invalid-member` when `mid` doesn't start with `${fid}-`;
  - idempotent: existing signup already `signed-up` → 200 (no new write needed, but a set is acceptable) with `{ status:'signed-up' }`;
  - 409 `opportunity-full` when capacity reached (mock `listSignupsForOpp` → capacity active signups, excluding the caller's own id);
  - 201 success: writes the signup with `status:'signed-up'`, `hoursAwarded:0`, `sevaYear` from the opp, `fid` from session, `mid` from body, `signedUpByMid` from session.mid.

  (cancel) — mock `getSignup` + firestore set. Cases: 401; 404 missing; 403 when `signup.fid !== session.fid`; 409 `not-cancellable` when status not `signed-up`; 200 sets `status:'cancelled'` (merge).

- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement** (`signups/route.ts`):
```ts
import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { CreateSevaSignupSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';
import { getSignup, listSignupsForOpp, signupDocId, isActiveSignup } from '@/features/setu/seva/get-signups';

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'missing-fid' }, { status: 400 });

  const raw = await req.json().catch(() => null);
  const parsed = CreateSevaSignupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  const { oppId, mid } = parsed.data;

  const opp = await getOpportunity(oppId);
  if (!opp) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (opp.status !== 'open') return NextResponse.json({ error: 'not-open' }, { status: 409 });
  if (mid && !mid.startsWith(`${session.fid}-`)) return NextResponse.json({ error: 'invalid-member' }, { status: 400 });

  const id = signupDocId(oppId, session.fid);
  const existing = await getSignup(id);
  if (existing && existing.status === 'signed-up') {
    return NextResponse.json({ signupId: id, status: 'signed-up' });
  }

  if (opp.capacity != null) {
    const signups = await listSignupsForOpp(oppId);
    const active = signups.filter((s) => isActiveSignup(s) && s.signupId !== id).length;
    if (active >= opp.capacity) return NextResponse.json({ error: 'opportunity-full' }, { status: 409 });
  }

  await portalFirestore().collection('seva_signups').doc(id).set({
    signupId: id, oppId, fid: session.fid, mid: mid ?? null,
    sevaYear: opp.sevaYear, status: 'signed-up', hoursAwarded: 0,
    signedUpAt: FieldValue.serverTimestamp(), signedUpByMid: session.mid ?? null,
    confirmedAt: null, confirmedBy: null,
  });
  return NextResponse.json({ signupId: id, status: 'signed-up' }, { status: 201 });
}
```
(`[signupId]/cancel/route.ts`):
```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSignup } from '@/features/setu/seva/get-signups';

type Ctx = { params: Promise<{ signupId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const { signupId } = await ctx.params;
  const existing = await getSignup(signupId);
  if (!existing) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (existing.fid !== session.fid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'signed-up') return NextResponse.json({ error: 'not-cancellable' }, { status: 409 });
  await portalFirestore().collection('seva_signups').doc(signupId).set({ status: 'cancelled' }, { merge: true });
  return NextResponse.json({ ok: true });
}
```
- [ ] **Step 4 — run both → green; typecheck. Step 5 — commit:** `feat(seva): family sign-up + cancel APIs`.

---

## Task B6: Route access control

**Files:** modify `packages/shared-domain/src/auth/can-access-route.ts` + test.

- [ ] **Step 1 — failing test:**
```ts
describe('canAccessRoute — /api/setu/seva/* — any setu family', () => {
  it('allows family-manager and family-member', () => {
    expect(canAccessRoute(manager, '/api/setu/seva/opportunities', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/seva/signups', 'POST')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/seva/signups/o1__FAM001/cancel', 'POST')).toBe(true);
  });
  it('denies welcome-team and legacy family', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/seva/opportunities', 'GET')).toBe(false);
    expect(canAccessRoute(family, '/api/setu/seva/my', 'GET')).toBe(false);
  });
});
```
- [ ] **Step 2 — confirm fail.**
- [ ] **Step 3 — implement** — add BEFORE the manager-only `/api/setu/*` catch-all (e.g. right after the volunteering-skills block):
```ts
  // Setu API — seva: browse opportunities + sign up + cancel. Any signed-in
  // setu family (route handlers bind fid from the session and verify ownership).
  if (pathname === '/api/setu/seva' || pathname.startsWith('/api/setu/seva/')) {
    return isSetuFamily(claims);
  }
```
- [ ] **Step 4 — run shared-domain suite → green. Step 5 — commit:** `feat(seva): canAccessRoute for /api/setu/seva/*`.

---

## Task B7: Family `/family/seva` UI (themed, responsive, mobile-ready)

**Files:** create `apps/portal/src/features/setu/seva/seva-browser-client.ts`, `seva-browser.tsx`, `__tests__/seva-browser.test.tsx`, `apps/portal/src/app/family/seva/page.tsx`.

Read Slice A's "Design system" section + `SevaManager` + `apps/portal/src/app/family/page.tsx` first.

- [ ] **Step 1 — client wrappers** (`seva-browser-client.ts`):
```ts
export interface SevaOppView {
  oppId: string; title: string; description: string; date: string; location: string;
  defaultHours: number; capacity: number | null; sevaYear: string; status: 'open' | 'closed';
  mySignupStatus: 'signed-up' | 'completed' | 'no-show' | 'cancelled' | null; spotsLeft: number | null;
}
export interface SevaMySignup {
  signupId: string; oppId: string; mid: string | null; status: string; hoursAwarded: number;
  signedUpAt: string; opportunity: { title: string; date: string; defaultHours: number } | null;
}
export async function fetchOpportunities(): Promise<{ opportunities: SevaOppView[]; currentSevaYear: string | null; hoursPerYear: number }> { /* GET /api/setu/seva/opportunities */ }
export async function fetchMySignups(): Promise<SevaMySignup[]> { /* GET /api/setu/seva/my → data.mySignups ?? [] */ }
export async function signUp(oppId: string, mid: string | null): Promise<{ ok: boolean; error?: string }> { /* POST /api/setu/seva/signups body { oppId, mid: mid ?? undefined } — OMIT mid when null */ }
export async function cancelSignup(signupId: string): Promise<{ ok: boolean; error?: string }> { /* POST /api/setu/seva/signups/{signupId}/cancel */ }
```
All `fetch(... credentials:'same-origin')`; on `!res.ok` return `{ ok:false, error: body.error }`. For `signUp`, build the body conditionally so `mid` is omitted when null (exactOptionalPropertyTypes — never send `undefined` as a value you assigned).

- [ ] **Step 2 — component test** (`seva-browser.test.tsx`) — mock `@cmt/ui` + `../seva-browser-client`. Assert: renders the goal header (`{hoursPerYear} hrs`); renders an open opportunity title from `initialOpportunities`; clicking "Sign up" (then confirming, with the optional member dropdown defaulting to "Whole family") calls `signUp(oppId, null)`; an opportunity with `mySignupStatus:'signed-up'` shows a "Signed up" state + a "Cancel" action that calls `cancelSignup`; an opportunity with `spotsLeft:0` shows "Full" and its Sign-up is disabled; the `seva-year-not-set`/empty (`currentSevaYear:null`) state shows a friendly "No seva opportunities yet" message.

- [ ] **Step 3 — implement `SevaBrowser`** (client). Props:
```ts
{ currentSevaYear: string | null; hoursPerYear: number;
  initialOpportunities: SevaOppView[]; initialMySignups: SevaMySignup[];
  members: { mid: string; name: string }[] }
```
Structure (themed, responsive, mobile + desktop blocks):
- **Header:** eyebrow "Seva" + `<h1>` "Seva opportunities" + a line: "Lend a hand — our family goal is {hoursPerYear} hours of seva this year." (Hours progress bar is Slice D; show the goal as text now.)
- **Empty state** (when `currentSevaYear == null` OR no opportunities): a warm branded card "No seva opportunities posted yet — check back soon."
- **Opportunities list:** each `card` → title, Toronto date, hours, location, `spotsLeft` ("{n} spots left" / "Full" / no badge when unlimited), description. Action area:
  - if `mySignupStatus === 'signed-up'`: a "Signed up ✓" `pill` + a **Cancel** ghost button (confirm) → `cancelSignup` → refetch.
  - else if `spotsLeft === 0`: a disabled "Full" button.
  - else: a **Sign up** primary button → opens an inline control with an optional **"Credit a member"** `<select>` (first option "Whole family" = null, then `members`) + a confirm → `signUp(oppId, selectedMidOrNull)` → on `opportunity-full` toast "That opportunity just filled up"; on ok toast + refetch both lists.
- **My signups** section: list the family's active signups (title, date, member credited if any, hours-when-confirmed later) + Cancel for `signed-up` ones.
- Manage refetch via `fetchOpportunities()` + `fetchMySignups()` after each mutation; hold lists in `useState`. No nested component declarations; use a render helper if needed.

- [ ] **Step 4 — implement the page** (`app/family/seva/page.tsx`):
```tsx
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getFamilySevaView } from '@/features/setu/seva/get-family-seva-view';
import { SevaBrowser } from '@/features/setu/seva/seva-browser';

export const metadata = { title: 'Seva — CMT Portal' };

export default async function FamilySevaPage() {
  await connection();
  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in?from=/family/seva');
  const view = await getFamilySevaView(data.family.fid);
  const members = data.members.map((m) => ({ mid: m.mid, name: `${m.firstName} ${m.lastName}`.trim() }));
  return (
    <SevaBrowser
      currentSevaYear={view.currentSevaYear}
      hoursPerYear={view.hoursPerYear}
      initialOpportunities={view.opportunities}
      initialMySignups={view.mySignups}
      members={members}
    />
  );
}
```
- [ ] **Step 5 — run component test → PASS; `tsc --noEmit` → clean.**
- [ ] **Step 6 — designer pass:** dispatch `oh-my-claudecode:designer` (opus) to elevate `seva-browser.tsx` visuals (cards, sign-up affordance, "signed up" state, spots-left, member-credit control, empty state) against the tokens + ensure the mobile experience is excellent — WITHOUT changing behavior or breaking the tests. Re-run test + typecheck.
- [ ] **Step 7 — commit:** `feat(seva): themed /family/seva browse + sign-up UI`.

---

## Task B8: Family navigation entry

**Files:** modify `apps/portal/src/features/family/components/desktop-sidebar.tsx` + `apps/portal/src/features/family/components/mobile-bottom-nav.tsx`.

- [ ] **Step 1** — in `desktop-sidebar.tsx`: add a `'seva'` item to `FAMILY_NAV_ITEMS` (e.g. after Programs): `['seva', 'Seva', 'heart', '/family/seva']` (`'seva'` is already in the `SidebarTab` union + `SetuIcon.heart` exists). Add to `deriveActiveFromPathname`: `if (pathname.startsWith('/family/seva')) return 'seva';` (place before any generic `/family` fallback). In `mobile-bottom-nav.tsx`: add a Seva tab/More entry → `/family/seva` (match the file's pattern; if it's a fixed 4-5 tab bar, add Seva where it fits or to its overflow). If a nav test asserts the family item list, update it.
- [ ] **Step 2** — run touched nav tests + `tsc --noEmit`. **Step 3 — commit:** `feat(seva): family nav entry for /family/seva`.

---

## Slice B verification (before done)

- [ ] `tsc --noEmit` (portal + shared-domain) → 0 errors; `pnpm lint` clean; full vitest suites green.
- [ ] **Mobile-app readiness:** every `/api/setu/seva/*` handler uses `readSessionFromHeaders` (grep to confirm no `getCurrentFamily`/`cookies` in handlers); ISO-string dates; consistent envelope.
- [ ] Final review pass (spec-compliance + code-quality, Opus).
- [ ] **Mock-free UAT walkthrough:** sign in as a family → `/family/seva` (mobile + desktop) → sign up for an opportunity (with and without a member credit) → see it under "My signups" → cancel it → re-sign-up. Try a capacity-limited opp until "Full". Confirm a closed opp doesn't accept sign-ups. Report UAT status explicitly.
- [ ] Push (full gate). Update resume-note memory: Slice B shipped; C/D remain.

## Not in Slice B (later)
- **Slice C:** admin/welcome roster + confirm (completed/no-show + hoursAwarded) → hours accrue; `seva_signups (oppId,status)` + `(fid,sevaYear,status)` indexes.
- **Slice D:** dashboard "Seva hours · X of {target}" progress card + reminder; compliance report; welcome family-detail hours.
