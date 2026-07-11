# Kiosk new-ID lookup + auto-enroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the portal check-in kiosk resolve a family by the new 4-digit `publicFid` (fallback `legacyFid`) against the Setu DB and auto-enroll unrecognized families/children into the current Bala Vihar year (unpaid, all eligible kids).

**Architecture:** Three new server pieces in a new `features/setu/check-in/` module - a resolver (`resolveKioskFamily`), an auto-enroll helper (`autoEnrollBalaVihar`), and a public Setu-aware kiosk endpoint that records the check-in and calls both - plus the `'kiosk'` `enrolledVia` value and a thin kiosk-UI wire. The teacher-attendance auto-enroll already exists (`enrollFamilyOnFirstAttendance`) and is only verified/flag-enabled.

**Tech Stack:** Next.js 16 App Router, Firebase Admin (Firestore, `portalFirestore()` = `chinmaya-setu-uat`), Zod, Vitest (fake-firestore), Playwright.

## Global Constraints

- **UAT only.** All verification targets `chinmaya-setu-uat`. Never touch prod `715b8`. The prod cutover is gated separately by `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK` and out of scope.
- **Everything new is gated by `flags.checkInKiosk`** (`apps/portal/src/lib/flags.ts:12`, `master && NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK==='true'`). Off in prod today.
- **Auto-enroll = unpaid, all eligible children.** Reuse `enrollFamily()` verbatim - do not re-implement eligibility or payment. Enrollment is `status:'active'` with an outstanding suggested amount; no charge.
- **Idempotent.** `enrollFamily` no-ops an already-active enrollment (`created:false`). Auto-enroll must never throw for the expected skip cases (adult-only family → `no-eligible-members`; no open offering).
- **`publicFid` is not DB-unique.** Resolve with `.limit(1)`, first hit authoritative (sequential allocator makes collisions unlikely).
- **Public endpoint trust model.** The new endpoint is public + `checkInKiosk`-gated, matching the existing kiosk routes (a kiosk is a trusted physical device, no per-user auth). It only writes for families that already exist in Setu and only creates unpaid enrollments - no financial action. Add it to BOTH `public-routes.ts` and `canAccessRoute`.
- **Contract discipline.** The `enrolledVia` enum change touches a `@cmt/shared-domain` schema used by `/api/setu/enrollments`; append a `MOBILE_API_CHANGELOG.md` entry. Update the cutover runbook §14.
- **No new Firestore indexes.** Resolver uses single-field equality on `publicFid`/`legacyFid` (auto-indexed); offering/enrollment queries are already indexed.
- No em dashes in shipped strings/comments (use `-`). Commit author is the repo default; never add an agent co-author.

---

## File Structure

- `packages/shared-domain/src/setu/schemas/enrollment.ts` (modify) - add `'kiosk'` to the `enrolledVia` enum.
- `apps/portal/src/features/setu/check-in/resolve-kiosk-family.ts` (create) - `resolveKioskFamily(id)`.
- `apps/portal/src/features/setu/check-in/auto-enroll-bala-vihar.ts` (create) - `autoEnrollBalaVihar(family)`.
- `apps/portal/src/features/setu/check-in/__tests__/*.test.ts` (create) - unit tests for both helpers.
- `apps/portal/src/app/api/check-in/setu/check-in/route.ts` (create) - the public Setu kiosk endpoint.
- `apps/portal/src/app/api/check-in/setu/check-in/__tests__/route.test.ts` (create) - route test.
- `packages/shared-domain/src/auth/public-routes.ts` + `can-access-route.ts` (modify) - allow the new path.
- `apps/portal/src/features/check-in/kiosk/family-id-lookup-form.tsx` + kiosk panel (modify) - call the Setu endpoint, show the enrolled confirmation.
- `apps/portal/docs/MOBILE_API_CHANGELOG.md`, `docs/runbooks/production-cutover-checklist.md` (modify) - contract + runbook.
- `apps/portal/e2e/setu/kiosk-auto-enroll.spec.ts` (create) - deployed-UAT E2E (owner-gated).

---

### Task 1: Add `'kiosk'` to the `enrolledVia` enum

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/enrollment.ts:22`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/enrollment.test.ts` (create if absent)
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

**Interfaces:**
- Produces: `EnrollmentDoc['enrolledVia']` now includes `'kiosk'`; `enrollFamily`'s `enrolledVia` param (`EnrollVia = EnrollmentDoc['enrolledVia']`, `enroll-family.ts:5`) accepts it automatically.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/setu/schemas/__tests__/enrollment.test.ts
import { describe, it, expect } from 'vitest';
import { EnrollmentDocSchema } from '../enrollment';

describe('EnrollmentDocSchema.enrolledVia', () => {
  it("accepts 'kiosk' as an enrolledVia value", () => {
    const base = {
      eid: 'CMT-X-o1', fid: 'CMT-X', oid: 'o1', programKey: 'bala-vihar',
      programLabel: 'Bala Vihar', termLabel: '2026-27', location: 'Brampton',
      enrolledAt: new Date(), enrolledVia: 'kiosk', enrolledByMid: null,
      enrolledMids: ['CMT-X-01'], suggestedAmountSnapshot: 100,
      suggestedAmountOverride: null, status: 'active',
      cancelledAt: null, cancelledReason: null,
    };
    expect(EnrollmentDocSchema.parse(base).enrolledVia).toBe('kiosk');
  });
});
```

- [ ] **Step 2: Run it - expect FAIL** (`'kiosk'` not in enum)

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/enrollment.test.ts`
Expected: FAIL - `Invalid enum value. Expected 'family-initiated' | ...`.

- [ ] **Step 3: Add `'kiosk'` to the enum**

```ts
// enrollment.ts:22
  enrolledVia: z.enum(['family-initiated', 'first-attendance', 'welcome-team', 'promotion', 'kiosk']),
```

- [ ] **Step 4: Run it - expect PASS.**

- [ ] **Step 5: Add the changelog entry** (newest-first) to `apps/portal/docs/MOBILE_API_CHANGELOG.md`:

```markdown
## 2026-07-11 - <pending> - enrolledVia gains 'kiosk'
`EnrollmentDoc.enrolledVia` (schemas/enrollment.ts) now includes `'kiosk'` for door/kiosk-driven auto-enrollments. Mobile: widen the enrolledVia union to accept `'kiosk'` on any enrollment read; no request-shape change.
```

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(setu): add 'kiosk' enrolledVia for door auto-enroll"`

---

### Task 2: `resolveKioskFamily` - resolve a Setu family by publicFid then legacyFid

**Files:**
- Create: `apps/portal/src/features/setu/check-in/resolve-kiosk-family.ts`
- Test: `apps/portal/src/features/setu/check-in/__tests__/resolve-kiosk-family.test.ts`

**Interfaces:**
- Produces: `resolveKioskFamily(id: string): Promise<ResolvedKioskFamily | null>` where
  `ResolvedKioskFamily = { fid: string; location: Location | null; publicFid: string | null; legacyFid: string | null; name: string; matchedOn: 'publicFid' | 'legacyFid' }`.

- [ ] **Step 1: Write the failing test** (fake-firestore; follow the existing `search-families` test setup for the harness)

```ts
// __tests__/resolve-kiosk-family.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const families = new Map<string, Record<string, unknown>>();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({
      where: (field: string, _op: string, val: string) => ({
        limit: () => ({
          get: async () => {
            const docs = [...families.entries()]
              .filter(([, d]) => d[field] === val)
              .slice(0, 1)
              .map(([id, d]) => ({ id, data: () => d }));
            return { docs };
          },
        }),
      }),
    }),
  }),
}));

import { resolveKioskFamily } from '../resolve-kiosk-family';

beforeEach(() => families.clear());

it('resolves by publicFid first', async () => {
  families.set('CMT-A', { publicFid: '1075', legacyFid: '477', location: 'Brampton', name: 'Rana family' });
  const r = await resolveKioskFamily('1075');
  expect(r).toMatchObject({ fid: 'CMT-A', matchedOn: 'publicFid', legacyFid: '477', location: 'Brampton' });
});

it('falls back to legacyFid when no publicFid match', async () => {
  families.set('CMT-A', { publicFid: '1075', legacyFid: '477', location: 'Brampton', name: 'Rana family' });
  const r = await resolveKioskFamily('477');
  expect(r).toMatchObject({ fid: 'CMT-A', matchedOn: 'legacyFid' });
});

it('returns null for an unknown id and for blank input', async () => {
  expect(await resolveKioskFamily('999999')).toBeNull();
  expect(await resolveKioskFamily('   ')).toBeNull();
});
```

- [ ] **Step 2: Run it - expect FAIL** (module not found).

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/check-in/__tests__/resolve-kiosk-family.test.ts`

- [ ] **Step 3: Implement**

```ts
// resolve-kiosk-family.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { Location } from '@cmt/shared-domain';

export type ResolvedKioskFamily = {
  fid: string; // CMT- doc id (join key)
  location: Location | null;
  publicFid: string | null;
  legacyFid: string | null;
  name: string;
  matchedOn: 'publicFid' | 'legacyFid';
};

/**
 * Resolve a Setu family from the number a family/sevak enters at the kiosk.
 * Tries the new publicFid first (the id we want families to adopt), then the
 * legacy check-in id. publicFid is not DB-unique - limit(1), first hit wins.
 */
export async function resolveKioskFamily(id: string): Promise<ResolvedKioskFamily | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const families = portalFirestore().collection('families');

  const byPublic = await families.where('publicFid', '==', trimmed).limit(1).get();
  const publicDoc = byPublic.docs[0];
  const doc = publicDoc ?? (await families.where('legacyFid', '==', trimmed).limit(1).get()).docs[0];
  if (!doc) return null;

  const data = doc.data() as Record<string, unknown>;
  return {
    fid: doc.id,
    location: (typeof data.location === 'string' ? data.location : null) as Location | null,
    publicFid: typeof data.publicFid === 'string' ? data.publicFid : null,
    legacyFid: typeof data.legacyFid === 'string' ? data.legacyFid : null,
    name: typeof data.name === 'string' && data.name ? data.name : doc.id,
    matchedOn: publicDoc ? 'publicFid' : 'legacyFid',
  };
}
```

- [ ] **Step 4: Run it - expect PASS.**

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(setu): resolveKioskFamily by publicFid then legacyFid"`

---

### Task 3: `autoEnrollBalaVihar` - the auto-enroll decision

**Files:**
- Create: `apps/portal/src/features/setu/check-in/auto-enroll-bala-vihar.ts`
- Test: `apps/portal/src/features/setu/check-in/__tests__/auto-enroll-bala-vihar.test.ts`

**Interfaces:**
- Consumes: `getOpenOfferingsForFamily(programKey, location)` (`features/setu/enrollment/get-open-offerings.ts:86`) returning `OpenOffering[]` with `.oid`; `enrollFamily({fid, oid, enrolledVia, enrolledByMid})` (`enroll-family.ts:34`) which throws `'no-eligible-members'` for adult-only families; `BALA_VIHAR` (`@cmt/shared-domain`, value `'bala-vihar'`).
- Produces: `autoEnrollBalaVihar(family: { fid: string; location: Location | null }): Promise<AutoEnrollResult>` where
  `AutoEnrollResult = { enrolled: true; created: boolean; eid: string } | { enrolled: false; reason: 'no-open-offering' | 'no-eligible-members' }`.

- [ ] **Step 1: Write the failing test** (mock the two collaborators)

```ts
// __tests__/auto-enroll-bala-vihar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getOpenOfferingsForFamily = vi.fn();
const enrollFamily = vi.fn();
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({ getOpenOfferingsForFamily }));
vi.mock('@/features/setu/enrollment/enroll-family', () => ({ enrollFamily }));

import { autoEnrollBalaVihar } from '../auto-enroll-bala-vihar';

beforeEach(() => { getOpenOfferingsForFamily.mockReset(); enrollFamily.mockReset(); });

it('enrolls into the first open BV offering with enrolledVia=kiosk', async () => {
  getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }, { oid: 'bv-old' }]);
  enrollFamily.mockResolvedValue({ created: true, eid: 'CMT-A-bv-2026', suggestedAmountSnapshot: 100 });
  const r = await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' });
  expect(getOpenOfferingsForFamily).toHaveBeenCalledWith('bala-vihar', 'Brampton');
  expect(enrollFamily).toHaveBeenCalledWith({ fid: 'CMT-A', oid: 'bv-2026', enrolledVia: 'kiosk', enrolledByMid: null });
  expect(r).toEqual({ enrolled: true, created: true, eid: 'CMT-A-bv-2026' });
});

it('reports a no-op when the family is already enrolled', async () => {
  getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }]);
  enrollFamily.mockResolvedValue({ created: false, eid: 'CMT-A-bv-2026', suggestedAmountSnapshot: 100 });
  expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: true, created: false, eid: 'CMT-A-bv-2026' });
});

it('skips (no-open-offering) when there is no BV offering', async () => {
  getOpenOfferingsForFamily.mockResolvedValue([]);
  expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: false, reason: 'no-open-offering' });
  expect(enrollFamily).not.toHaveBeenCalled();
});

it('skips (no-eligible-members) for an adult-only family', async () => {
  getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }]);
  enrollFamily.mockRejectedValue(new Error('no-eligible-members'));
  expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: false, reason: 'no-eligible-members' });
});

it('rethrows unexpected enrollFamily errors', async () => {
  getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }]);
  enrollFamily.mockRejectedValue(new Error('offering-disabled'));
  await expect(autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).rejects.toThrow('offering-disabled');
});
```

- [ ] **Step 2: Run it - expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
// auto-enroll-bala-vihar.ts
import 'server-only';
import { BALA_VIHAR } from '@cmt/shared-domain';
import type { Location } from '@cmt/shared-domain';
import { getOpenOfferingsForFamily } from '@/features/setu/enrollment/get-open-offerings';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';

export type AutoEnrollResult =
  | { enrolled: true; created: boolean; eid: string }
  | { enrolled: false; reason: 'no-open-offering' | 'no-eligible-members' };

/**
 * Auto-enroll a resolved kiosk family into the CURRENT Bala Vihar offering.
 * Idempotent (enrollFamily no-ops an already-active enrollment). Swallows the
 * two expected skip cases; real offering/family errors bubble to the caller.
 */
export async function autoEnrollBalaVihar(
  family: { fid: string; location: Location | null },
): Promise<AutoEnrollResult> {
  const offerings = await getOpenOfferingsForFamily(BALA_VIHAR, family.location);
  const oid = offerings[0]?.oid;
  if (!oid) return { enrolled: false, reason: 'no-open-offering' };

  try {
    const res = await enrollFamily({ fid: family.fid, oid, enrolledVia: 'kiosk', enrolledByMid: null });
    return { enrolled: true, created: res.created, eid: res.eid };
  } catch (e) {
    if (e instanceof Error && e.message === 'no-eligible-members') {
      return { enrolled: false, reason: 'no-eligible-members' };
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run it - expect PASS** (all 5 cases).

- [ ] **Step 5: Verify `BALA_VIHAR` is exported from `@cmt/shared-domain`**

Run: `pnpm --filter @cmt/portal exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i "BALA_VIHAR" || echo OK`
Expected: `OK`. If it errors, import from the schema module instead: `import { BALA_VIHAR } from '@cmt/shared-domain/setu';`

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(setu): autoEnrollBalaVihar helper (unpaid, all eligible kids)"`

---

### Task 4: Public Setu kiosk endpoint - resolve + record check-in + auto-enroll

**Files:**
- Create: `apps/portal/src/app/api/check-in/setu/check-in/route.ts`
- Test: `apps/portal/src/app/api/check-in/setu/check-in/__tests__/route.test.ts`
- Modify: `packages/shared-domain/src/auth/public-routes.ts`, `packages/shared-domain/src/auth/can-access-route.ts`
- Modify: `docs/runbooks/production-cutover-checklist.md`

**Interfaces:**
- Consumes: `resolveKioskFamily` (Task 2), `autoEnrollBalaVihar` (Task 3), `flags.checkInKiosk`.
- Produces: `POST /api/check-in/setu/check-in` body `{ id: string; students: Record<string, boolean> }` →
  `200 { family: { fid; publicFid; legacyFid; name }; enroll: AutoEnrollResult; checkInIds: string[] }`, `404 { error: 'family-not-found' }`, `400 { error: 'bad-request' }`, `404 { error: 'not-found' }` when the flag is off.

- [ ] **Step 1: Write the failing route test** (mock the helpers + firestore; mirror the existing `check-in/families/[familyId]/check-in` route test style)

```ts
// __tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { checkInKiosk: true } }));
const resolveKioskFamily = vi.fn();
const autoEnrollBalaVihar = vi.fn();
vi.mock('@/features/setu/check-in/resolve-kiosk-family', () => ({ resolveKioskFamily }));
vi.mock('@/features/setu/check-in/auto-enroll-bala-vihar', () => ({ autoEnrollBalaVihar }));
const added: unknown[] = [];
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ add: async (d: unknown) => { added.push(d); return { id: `ci-${added.length}` }; } }) }),
}));

import { POST } from '../route';
const req = (body: unknown) => new Request('http://x/api/check-in/setu/check-in', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => { resolveKioskFamily.mockReset(); autoEnrollBalaVihar.mockReset(); added.length = 0; });

it('resolves, records a check-in, and auto-enrolls', async () => {
  resolveKioskFamily.mockResolvedValue({ fid: 'CMT-A', publicFid: '1075', legacyFid: '477', location: 'Brampton', name: 'Rana family', matchedOn: 'publicFid' });
  autoEnrollBalaVihar.mockResolvedValue({ enrolled: true, created: true, eid: 'CMT-A-bv' });
  const res = await POST(req({ id: '1075', students: { 'CMT-A-02': true } }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.family).toMatchObject({ fid: 'CMT-A', publicFid: '1075' });
  expect(body.enroll).toEqual({ enrolled: true, created: true, eid: 'CMT-A-bv' });
  expect(autoEnrollBalaVihar).toHaveBeenCalledWith({ fid: 'CMT-A', location: 'Brampton' });
  expect(added).toHaveLength(1); // one check_in_event
});

it('404s when the id resolves to no Setu family', async () => {
  resolveKioskFamily.mockResolvedValue(null);
  const res = await POST(req({ id: '999', students: {} }));
  expect(res.status).toBe(404);
  expect(autoEnrollBalaVihar).not.toHaveBeenCalled();
});

it('400s on a malformed body', async () => {
  const res = await POST(req({ id: 5 }));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run it - expect FAIL** (route not found).

- [ ] **Step 3: Implement the route** (keys `check_in_events` by `legacyFid ?? publicFid ?? fid` so existing dashboards that read by the legacy id keep working)

```ts
// route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import { resolveKioskFamily } from '@/features/setu/check-in/resolve-kiosk-family';
import { autoEnrollBalaVihar } from '@/features/setu/check-in/auto-enroll-bala-vihar';

const bodySchema = z.object({
  id: z.string().min(1),
  students: z.record(z.string(), z.boolean()),
});

export async function POST(req: Request) {
  if (!flags.checkInKiosk) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const family = await resolveKioskFamily(parsed.data.id);
  if (!family) return NextResponse.json({ error: 'family-not-found' }, { status: 404 });

  // Record the check-in, keyed by the legacy id when present (bridges the
  // existing check_in_events dashboards), else the publicFid, else the CMT fid.
  const eventFid = family.legacyFid ?? family.publicFid ?? family.fid;
  const coll = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();
  const checkInIds: string[] = [];
  for (const [sid, isPresent] of Object.entries(parsed.data.students)) {
    const ref = await coll.add({ fid: eventFid, sid, status: isPresent ? 'present' : 'absent', checkedInBy: 'sevak' as const, checkedInAt });
    checkInIds.push(ref.id);
  }

  const enroll = await autoEnrollBalaVihar({ fid: family.fid, location: family.location });

  return NextResponse.json({
    family: { fid: family.fid, publicFid: family.publicFid, legacyFid: family.legacyFid, name: family.name },
    enroll,
    checkInIds,
  });
}
```

- [ ] **Step 4: Run it - expect PASS.**

- [ ] **Step 5: Open the route in the auth layer.** In `packages/shared-domain/src/auth/public-routes.ts`, add `/api/check-in/setu/check-in` to the `PUBLIC_ROUTES` list beside the existing `/api/check-in/families/:familyId/check-in` entry. In `can-access-route.ts`, add an explicit allow beside the other `/api/check-in/*` public rules:

```ts
// can-access-route.ts - near the other /api/check-in public entries
if (pathname === '/api/check-in/setu/check-in') return true; // public kiosk (flag-gated in-handler)
```

Add/extend the matching assertions in `packages/shared-domain/src/__tests__/` (mirror an existing public-route test): a no-claims request returns `true` for this path.

- [ ] **Step 6: Runbook.** Append a §14 entry to `docs/runbooks/production-cutover-checklist.md` (dated 2026-07-11): new public `POST /api/check-in/setu/check-in`, new `'kiosk'` enrolledVia, no new indexes/migration, UAT-only, prod gated by `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK`. Update the changelog `<pending>` from Task 1 to the enum commit SHA in this commit.

- [ ] **Step 7: Commit** `git add -A && git commit -m "feat(setu): public Setu kiosk check-in endpoint (resolve + record + auto-enroll)"`

---

### Task 5: Wire the kiosk UI to the Setu endpoint

**Files:**
- Modify: `apps/portal/src/features/check-in/kiosk/family-id-lookup-form.tsx`
- Modify: `apps/portal/src/features/check-in/kiosk/kiosk-check-in-panel.tsx` (the panel that submits the present/absent map)
- Test: extend the nearest kiosk component test, or add `apps/portal/src/features/check-in/kiosk/__tests__/setu-kiosk.test.tsx`

**Interfaces:**
- Consumes: `POST /api/check-in/setu/check-in` (Task 4).

- [ ] **Step 1: Read the current kiosk flow** end-to-end: `family-id-lookup-form.tsx` (numeric input → `GET /api/check-in/families/{id}`) and the panel that renders children + submits `POST /api/check-in/families/{id}/check-in`. Note the exact props/state so the Setu path mirrors them.

- [ ] **Step 2: Write a failing component test** asserting that submitting the check-in posts to `/api/check-in/setu/check-in` with `{ id, students }` and, when the response `enroll.enrolled` is true and `created` is true, renders a confirmation like `Enrolled in Bala Vihar`. (Mock `fetch`.)

- [ ] **Step 3: Implement.** Point the kiosk lookup + submit at the Setu endpoint: on submit, `POST /api/check-in/setu/check-in` with `{ id, students }`. On `enroll.created === true`, show a subtle inline confirmation ("Added to Bala Vihar for this year"). Keep the number input numeric; accept both the 4-digit publicFid and the legacy id (the server resolves either). If the Setu endpoint returns `404 family-not-found`, fall back to the existing legacy lookup so pre-migration families still check in.

- [ ] **Step 4: Run the component test - expect PASS**, and run the whole kiosk test file.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(check-in): kiosk uses the Setu endpoint; new-ID lookup + enroll confirmation"`

---

### Task 6: Verify the teacher first-attendance auto-enroll (existing)

**Files:**
- Read: `apps/portal/src/features/setu/enrollment/enroll-on-first-attendance.ts`, `apps/portal/src/features/setu/teacher/guests.ts`, `apps/portal/src/features/setu/teacher/save-attendance.ts`, `apps/portal/src/middleware.ts:74-83`
- Possibly modify: the teacher attendance call site (only if the auto-enroll is not wired for a plain non-enrolled child).

**Interfaces:**
- Consumes: `enrollFamilyOnFirstAttendance({ fid, oid, markedByTeacherUid })` (`enroll-on-first-attendance.ts:17`, `enrolledVia:'first-attendance'`).

- [ ] **Step 1: Trace the path.** Confirm that when a teacher marks a child present whose family has no active BV enrollment, `enrollFamilyOnFirstAttendance` is invoked (via the guest flow at `teacher/guests.ts:57`). Write down whether it fires for ANY non-enrolled child or only ones explicitly added as "guests" - this is spec open-question #3.

- [ ] **Step 2:** If it only fires for explicit guests, add a step in the attendance-save path (`save-attendance.ts`) so a present mark for a non-roster child triggers `enrollFamilyOnFirstAttendance` before the mark is written. Cover it with a unit test (present mark for a non-enrolled child → enrollFamily called with `enrolledVia:'first-attendance'`). If it already covers any non-enrolled child, record that (no code change) and skip to Step 3.

- [ ] **Step 3:** Note in the plan/PR that the teacher path is enabled via `NEXT_PUBLIC_FEATURE_SETU_TEACHER=true` in UAT (`flags.setuTeacher`, `middleware.ts:74-83`). Do NOT enable it in prod.

- [ ] **Step 4: Commit** (only if code changed) `git add -A && git commit -m "feat(setu): teacher attendance auto-enrolls any non-enrolled child"`

---

### Task 7: Deployed-UAT E2E (owner-gated - PAUSE before running)

**Files:**
- Create: `apps/portal/e2e/setu/kiosk-auto-enroll.spec.ts`

- [ ] **Step 1: PAUSE.** Per owner instruction, stop here and hand back before running any deployed-UAT E2E. Present the diff for review first.

- [ ] **Step 2: Write the spec** (do not run yet). Realistic fixture per the project E2E discipline: seed (or reuse) a migrated UAT family that HAS a `publicFid`, has ≥2 children, and has NO active BV enrollment. With `checkInKiosk` enabled on the deployed UAT target:
  - `POST /api/check-in/setu/check-in` with the family's **publicFid** and both children present → assert `200`, `family.publicFid` matches, `enroll.enrolled === true`, `enroll.created === true`.
  - Re-post the same → assert `enroll.created === false` (idempotent).
  - `POST` with the family's **legacyFid** → resolves the same family.
  - Assert (via `/api/setu/dashboard` or a roster read) that an active Bala Vihar enrollment now exists for the eligible children.
  - Clean up any enrollment the test created (mutation specs must self-clean).

- [ ] **Step 3:** Hand the spec + the full branch diff to the owner. Run `pnpm --filter @cmt/portal test:e2e` against deployed UAT only after the owner approves.

---

## Self-Review

**1. Spec coverage.**
- Setu-aware resolver (publicFid → legacyFid) → Task 2. ✓
- Auto-enroll on check-in (`enrollFamily`, `'kiosk'`, current BV offering) → Tasks 1, 3, 4. ✓
- New `'kiosk'` enrolledVia → Task 1. ✓
- Teacher first-attendance auto-enroll (verify existing) → Task 6. ✓
- Deployed-UAT E2E, realistic fixture → Task 7. ✓
- Contract + runbook + no-index/no-migration → Tasks 1, 4 (Global Constraints). ✓
- UAT-only, flag-gated, unpaid/all-kids → Global Constraints, enforced in Tasks 3-4. ✓
- Open questions resolved: #1 (`.limit(1)`, Task 2); #2 (`check_in_events` keyed by `legacyFid ?? publicFid ?? fid`, Task 4); #3 (traced/closed in Task 6). ✓

**2. Placeholder scan.** No TBD/TODO; every code step shows real code; the only intentional deferral is the changelog `<pending>` SHA, pinned in Task 4 Step 6 (the established pattern).

**3. Type consistency.** `ResolvedKioskFamily` (Task 2) feeds `autoEnrollBalaVihar`'s `{ fid, location }` param (Task 3) and the route's response (Task 4); `AutoEnrollResult` shape is identical across Tasks 3-4-7; `enrolledVia:'kiosk'` (Task 1) matches every `enrollFamily` call in Task 3. Consistent.
