# Multi-Program Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the Bala-Vihar-only model into a program-agnostic foundation — an admin-managed `programs` registry, dynamic `programKey`, generalized `offerings`/`enrollment`, and a minimal family enroll flow — while Bala Vihar behaves identically.

**Architecture:** Approach A ("generalize what exists"). Add a `programs/{key}` Firestore collection; replace the frozen `PROGRAM_KEYS` enum with a dynamic slug validated at the service layer (cached `getProgram`); rename/generalize `donationPeriods` → `offerings` (location & donation optional; term/one-time/rolling); generalize `enrollment` (`enrolledMids`, `oid`, `programKey`); relax `levels`/`classCalendarEntries`. Hybrid admin IA; parameterized family enroll. Migration is UAT-only and idempotent.

**Tech Stack:** Next.js 16 (App Router, Cache Components), TypeScript, Zod, Firebase Admin (Firestore), Vitest + Testing Library, Turborepo/pnpm. Repo discipline: TDD; pre-push runs `typecheck && lint && test && build`; never `--no-verify`; UAT-only writes (`PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat`); never `--force` Firestore indexes against prod.

**Acceptance bar:** After migration, BV enroll / donate / dashboard / calendar / levels behave exactly as shipped. The full existing test suite stays green.

**Sequencing:** Execute AFTER BV's 2026-27 prod launch is stable. All work UAT-only until then.

---

## Cross-cutting requirements (apply to EVERY task — part of each task's definition of done)

**1. Mobile-responsive — all screens.** Every new or modified screen MUST be mobile-friendly at ≤390px, following the patterns established this cycle:
- `block md:hidden` mobile layout + `hidden md:block` desktop; convert wide tables to stacked card/divided-row layouts (reuse `periods-table.tsx`'s pattern).
- `className="csp"` on any fixed/overlay element so brand tokens resolve (see `feedback_csp_token_scoping`).
- bottom padding so content clears the fixed bottom nav; `clamp()` headings.
- A UI task is **not done** until visually verified at 390px. Component tests that render both mobile+desktop must query with `getAllByText` (dual render), not `getByText`.

**2. API layer is the future native mobile app's backend — design for reuse.** Treat every `/api/*` route as a shared contract for BOTH the web portal and the upcoming native app:
- Identity must work with a **Bearer ID token** (mobile) *and* the `__session` cookie (web). Middleware already supports both (`verifyPortalIdToken` for bearer). Handlers read identity only from the headers the middleware injects via `readSessionFromHeaders` — **no cookie-only assumptions** in handlers.
- **CORS** for mobile origins is already applied in `middleware.ts` (`MOBILE_CORS_ORIGINS`); new routes inherit it — don't bypass.
- Responses are **clean, stable JSON** with ISO-serialized dates; no data path that only works via HTML/redirect. Request/response validation uses the **shared-domain Zod schemas** so the mobile client reuses the exact same types.
- New family-facing route gating goes in `can-access-route.ts` and is exercised by a test (so the same authz holds for mobile bearer sessions).

---

## File Structure

**Shared domain (`packages/shared-domain/src/setu/`)**
- `schemas/offering.ts` — NEW (renamed from `donation-period.ts`): `LOCATIONS`/`Location`, `PAYMENT_SOURCES`/`PaymentSource`, `PricingTier`, `programKeySchema`, `BALA_VIHAR`, `OfferingDoc`, `Create/UpdateOfferingSchema`, `paymentSourceOf`. Removes `PROGRAM_KEYS`, `DonationPeriodDoc`.
- `schemas/program.ts` — NEW: `ProgramDoc`, `MemberType`, `ProgramTermType`, `ProgramEligibility`, `ProgramCapabilities`, `Create/UpdateProgramSchema`, `memberEligibleForProgram`.
- `schemas/enrollment.ts` — MODIFY: `enrolledMids`, `oid`, `programKey`, nullable `location`.
- `schemas/level.ts`, `schemas/class-calendar.ts` — MODIFY: `programKey` → `programKeySchema`, `location` nullable.
- `index.ts` — MODIFY barrel.

**Portal services (`apps/portal/src/features/setu/`)**
- `programs/get-programs.ts` — NEW: `getProgram`, `listPrograms`, `assertProgramActive` (cached).
- `enrollment/get-open-offerings.ts` — NEW: replaces `resolve-active-period.ts`.
- `enrollment/get-enrollments.ts`, `enrollment/enroll-family.ts` — MODIFY (offerings/oid/enrolledMids).
- `programs/eligible-programs.ts` — NEW: programs a family can enroll in now.

**API (`apps/portal/src/app/api/`)**
- `admin/programs/route.ts`, `admin/programs/[key]/route.ts` — NEW.
- `admin/offerings/` — renamed from `admin/donation-periods/`.
- `setu/programs/route.ts` — NEW (family-facing eligible list).
- `setu/enrollments/route.ts`, `setu/donations/checkout/route.ts`, `welcome/enrollments/route.ts` — MODIFY.

**Admin UI (`apps/portal/src/app/admin/`, `features/admin/`)**
- `programs/page.tsx` + `programs/[key]/page.tsx` + `features/admin/programs/{programs-table,program-form,offerings-panel}.tsx` — NEW.
- `donation-periods/` → repurposed under program scope; `levels/`, `calendar/` gain a program filter.

**Family UI (`apps/portal/src/app/family/`)**
- `page.tsx` — MODIFY (per-program cards).
- `enroll/[programKey]/page.tsx` — NEW (from current `enroll/page.tsx`).
- `programs/page.tsx` — NEW (minimal eligible list).

**Ops / config**
- `apps/portal/scripts/migrate-to-programs.ts` — NEW + pnpm alias.
- `firestore.indexes.json` — add `offerings` index.

---

## Phase A — Shared-domain schemas & helpers

### Task A1: Rename `donation-period.ts` → `offering.ts`; dynamic program key

**Files:**
- Rename: `packages/shared-domain/src/setu/schemas/donation-period.ts` → `packages/shared-domain/src/setu/schemas/offering.ts`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/offering.test.ts` (NEW)
- Modify: `packages/shared-domain/src/setu/index.ts`

- [ ] **Step 1: Write failing test** `offering.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  programKeySchema, BALA_VIHAR, OfferingDocSchema, CreateOfferingSchema, paymentSourceOf,
} from '../offering';

describe('programKeySchema', () => {
  it('accepts slugs, rejects junk', () => {
    expect(programKeySchema.safeParse('bala-vihar').success).toBe(true);
    expect(programKeySchema.safeParse('tabla').success).toBe(true);
    expect(programKeySchema.safeParse('Bala Vihar').success).toBe(false);
    expect(programKeySchema.safeParse('').success).toBe(false);
  });
  it('BALA_VIHAR is the seeded key', () => { expect(BALA_VIHAR).toBe('bala-vihar'); });
});

describe('OfferingDoc', () => {
  const base = {
    oid: 'bala-vihar-brampton-2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar',
    location: 'Brampton', termLabel: '2025-26', termType: 'term',
    startDate: new Date('2025-09-01'), endDate: new Date('2026-06-14'),
    pricingTiers: [{ effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year' }],
    enabled: true, createdAt: new Date(), createdBy: 'u', updatedAt: new Date(), updatedBy: 'u',
  };
  it('accepts a full term offering', () => { expect(OfferingDocSchema.safeParse(base).success).toBe(true); });
  it('accepts null location (location-less) and null endDate (rolling)', () => {
    expect(OfferingDocSchema.safeParse({ ...base, location: null, endDate: null, termType: 'rolling' }).success).toBe(true);
  });
  it('accepts empty pricingTiers (free program)', () => {
    expect(OfferingDocSchema.safeParse({ ...base, pricingTiers: [] }).success).toBe(true);
  });
});

describe('CreateOfferingSchema', () => {
  it('requires programKey + termLabel, allows null location & endDate', () => {
    const r = CreateOfferingSchema.safeParse({
      programKey: 'tabla', location: null, termLabel: 'Spring 2026', termType: 'one-time',
      startDate: '2026-04-01T00:00:00.000Z', endDate: '2026-04-01T00:00:00.000Z',
      pricingTiers: [], enabled: true,
    });
    expect(r.success).toBe(true);
  });
});

describe('paymentSourceOf', () => {
  it('defaults to portal', () => { expect(paymentSourceOf({})).toBe('portal'); });
  it('honors legacy', () => { expect(paymentSourceOf({ paymentSource: 'legacy' })).toBe('legacy'); });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/offering.test.ts`
Expected: FAIL (module `../offering` not found).

- [ ] **Step 3: Rename file & rewrite as `offering.ts`**

```bash
git mv packages/shared-domain/src/setu/schemas/donation-period.ts packages/shared-domain/src/setu/schemas/offering.ts
```

Edit `offering.ts`:
- Delete `export const PROGRAM_KEYS` and `export type ProgramKey`.
- Add:
```ts
export const programKeySchema = z.string().regex(/^[a-z0-9-]+$/, 'programKey must be a lowercase slug');
export const BALA_VIHAR = 'bala-vihar';
export const PROGRAM_TERM_TYPES = ['term', 'one-time', 'rolling'] as const;
export type ProgramTermType = (typeof PROGRAM_TERM_TYPES)[number];
```
- Replace `DonationPeriodDocSchema`/`DonationPeriodDoc` with:
```ts
export const OfferingDocSchema = z.object({
  oid: z.string().min(1),
  programKey: programKeySchema,
  programLabel: z.string().min(1),
  location: z.enum(LOCATIONS).nullable(),
  termLabel: z.string().min(1),
  termType: z.enum(PROGRAM_TERM_TYPES),
  startDate: z.date(),
  endDate: z.date().nullable(),
  pricingTiers: z.array(PricingTierSchema), // may be empty for free programs
  amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
  paymentSource: z.enum(PAYMENT_SOURCES).optional(),
  enabled: z.boolean(),
  createdAt: z.date(), createdBy: z.string().min(1),
  updatedAt: z.date(), updatedBy: z.string().min(1),
});
export type OfferingDoc = z.infer<typeof OfferingDocSchema>;

export const CreateOfferingSchema = z.object({
  programKey: programKeySchema,
  location: z.enum(LOCATIONS).nullable(),
  termLabel: z.string().min(1),
  termType: z.enum(PROGRAM_TERM_TYPES),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable(),
  pricingTiers: z.array(PricingTierSchema),
  amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
  paymentSource: z.enum(PAYMENT_SOURCES).default('portal'),
  enabled: z.boolean().default(true),
});
export type CreateOfferingInput = z.infer<typeof CreateOfferingSchema>;

export const UpdateOfferingSchema = CreateOfferingSchema.partial().omit({ programKey: true, location: true });
export type UpdateOfferingInput = z.infer<typeof UpdateOfferingSchema>;
```
- Keep `LOCATIONS`, `Location`, `PAYMENT_SOURCES`, `PaymentSource`, `PricingTierSchema`, `PricingTier`, `paymentSourceOf` (change its param type to `Pick<OfferingDoc,'paymentSource'> | { paymentSource?: PaymentSource }`).
- Drop the `tiersAscending` `.min(1)` requirement on pricingTiers (now may be empty); keep ascending refinement only when non-empty.

- [ ] **Step 4: Update barrel** `index.ts`: change `export * from './schemas/donation-period';` → `export * from './schemas/offering';`

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/offering.test.ts`
Expected: PASS. (Other packages won't compile yet — that's Tasks A4/A5 + Phase B/D.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/offering.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/schemas/__tests__/offering.test.ts
git commit -m "feat(shared-domain): rename donation-period -> offering, dynamic programKey"
```

### Task A2: `program.ts` schema + eligibility helper

**Files:**
- Create: `packages/shared-domain/src/setu/schemas/program.ts`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/program.test.ts`
- Modify: `index.ts` (add `export * from './schemas/program';`)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ProgramDocSchema, CreateProgramSchema, memberEligibleForProgram } from '../program';

const prog = {
  programKey: 'bala-vihar', label: 'Bala Vihar', shortDescription: 'Sunday classes',
  status: 'active', locations: ['Brampton'], termType: 'term',
  eligibility: { memberType: 'child' }, displayOrder: 0,
  capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
  createdAt: new Date(), createdBy: 'u', updatedAt: new Date(), updatedBy: 'u',
};

describe('ProgramDoc', () => {
  it('accepts a valid program', () => { expect(ProgramDocSchema.safeParse(prog).success).toBe(true); });
  it('accepts location-less (empty locations)', () => {
    expect(ProgramDocSchema.safeParse({ ...prog, locations: [] }).success).toBe(true);
  });
});

describe('memberEligibleForProgram', () => {
  const now = new Date('2026-01-15');
  const child = { type: 'Child' as const, birthMonthYear: '2018-01' }; // ~8y
  const adult = { type: 'Adult' as const, birthMonthYear: null };
  it('child program excludes adults', () => {
    expect(memberEligibleForProgram(adult, { memberType: 'child' }, now)).toBe(false);
    expect(memberEligibleForProgram(child, { memberType: 'child' }, now)).toBe(true);
  });
  it('any allows both', () => {
    expect(memberEligibleForProgram(adult, { memberType: 'any' }, now)).toBe(true);
    expect(memberEligibleForProgram(child, { memberType: 'any' }, now)).toBe(true);
  });
  it('enforces age range when set', () => {
    expect(memberEligibleForProgram(child, { memberType: 'child', minAgeYears: 10 }, now)).toBe(false);
    expect(memberEligibleForProgram(child, { memberType: 'child', maxAgeYears: 10 }, now)).toBe(true);
  });
  it('passes age gate when birthMonthYear unknown (no false-negative)', () => {
    expect(memberEligibleForProgram({ type: 'Child', birthMonthYear: null }, { memberType: 'child', minAgeYears: 5 }, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/program.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `program.ts`**

```ts
import { z } from 'zod';
import { LOCATIONS, programKeySchema, PROGRAM_TERM_TYPES } from './offering';

export const MEMBER_TYPES = ['child', 'adult', 'any'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];
export const ATTENDANCE_MODES = ['none', 'check-in', 'teacher'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ProgramEligibilitySchema = z.object({
  memberType: z.enum(MEMBER_TYPES),
  minAgeYears: z.number().int().min(0).max(120).optional(),
  maxAgeYears: z.number().int().min(0).max(120).optional(),
});
export type ProgramEligibility = z.infer<typeof ProgramEligibilitySchema>;

export const ProgramCapabilitiesSchema = z.object({
  usesOfferings: z.boolean(),
  usesDonation: z.boolean(),
  usesLevels: z.boolean(),
  usesCalendar: z.boolean(),
  attendanceMode: z.enum(ATTENDANCE_MODES),
});
export type ProgramCapabilities = z.infer<typeof ProgramCapabilitiesSchema>;

export const ProgramDocSchema = z.object({
  programKey: programKeySchema,
  label: z.string().min(1),
  shortDescription: z.string().default(''),
  status: z.enum(['active', 'draft', 'archived']),
  locations: z.array(z.enum(LOCATIONS)), // [] = location-less
  termType: z.enum(PROGRAM_TERM_TYPES),
  eligibility: ProgramEligibilitySchema,
  capabilities: ProgramCapabilitiesSchema,
  displayOrder: z.number().int().min(0),
  createdAt: z.date(), createdBy: z.string().min(1),
  updatedAt: z.date(), updatedBy: z.string().min(1),
});
export type ProgramDoc = z.infer<typeof ProgramDocSchema>;

export const CreateProgramSchema = z.object({
  programKey: programKeySchema,
  label: z.string().min(1),
  shortDescription: z.string().default(''),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
  locations: z.array(z.enum(LOCATIONS)).default([]),
  termType: z.enum(PROGRAM_TERM_TYPES),
  eligibility: ProgramEligibilitySchema,
  capabilities: ProgramCapabilitiesSchema,
  displayOrder: z.number().int().min(0).default(0),
});
export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;

export const UpdateProgramSchema = CreateProgramSchema.partial().omit({ programKey: true });
export type UpdateProgramInput = z.infer<typeof UpdateProgramSchema>;

/** Whole years between a 'YYYY-MM' birth month and now (null when unknown/malformed). */
function ageYears(birthMonthYear: string | null, now: Date): number | null {
  if (!birthMonthYear) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(birthMonthYear);
  if (!m) return null;
  const months = (now.getUTCFullYear() - Number(m[1])) * 12 + (now.getUTCMonth() + 1 - Number(m[2]));
  return Math.floor(months / 12);
}

/** Coarse program-level eligibility gate (levels still refine placement for BV). */
export function memberEligibleForProgram(
  member: { type: 'Adult' | 'Child'; birthMonthYear: string | null },
  eligibility: ProgramEligibility,
  now: Date,
): boolean {
  if (eligibility.memberType === 'child' && member.type !== 'Child') return false;
  if (eligibility.memberType === 'adult' && member.type !== 'Adult') return false;
  const age = ageYears(member.birthMonthYear, now);
  if (age != null) {
    if (eligibility.minAgeYears != null && age < eligibility.minAgeYears) return false;
    if (eligibility.maxAgeYears != null && age > eligibility.maxAgeYears) return false;
  }
  return true; // unknown age never causes a false-negative
}
```

- [ ] **Step 4: Add barrel export, run test.** Add `export * from './schemas/program';` to `index.ts`. Run the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/program.ts packages/shared-domain/src/setu/schemas/__tests__/program.test.ts packages/shared-domain/src/setu/index.ts
git commit -m "feat(shared-domain): add ProgramDoc + memberEligibleForProgram"
```

### Task A3: Generalize `enrollment.ts`

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/enrollment.ts`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/enrollment.test.ts` (extend or create)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { EnrollmentDocSchema, PostEnrollmentBodySchema } from '../enrollment';

const base = {
  eid: 'e1', fid: 'f1', oid: 'bala-vihar-brampton-2025-26', programKey: 'bala-vihar',
  programLabel: 'Bala Vihar', termLabel: '2025-26', location: 'Brampton',
  enrolledAt: new Date(), enrolledVia: 'family-initiated', enrolledByMid: 'f1-01',
  enrolledMids: ['f1-02'], suggestedAmountSnapshot: 500, suggestedAmountOverride: null,
  status: 'active', cancelledAt: null, cancelledReason: null,
};
describe('EnrollmentDoc', () => {
  it('accepts oid + enrolledMids + null location', () => {
    expect(EnrollmentDocSchema.safeParse(base).success).toBe(true);
    expect(EnrollmentDocSchema.safeParse({ ...base, location: null }).success).toBe(true);
  });
});
describe('PostEnrollmentBodySchema', () => {
  it('requires oid (was pid)', () => {
    expect(PostEnrollmentBodySchema.safeParse({ oid: 'x' }).success).toBe(true);
    expect(PostEnrollmentBodySchema.safeParse({ pid: 'x' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/enrollment.test.ts` → FAIL.

- [ ] **Step 3: Edit `enrollment.ts`** — in `EnrollmentDocSchema`: rename `pid`→`oid`, `periodLabel`→`termLabel`, `childrenMids`→`enrolledMids`, add `programKey: programKeySchema`, change `location` to `z.enum(LOCATIONS).nullable()`. Update `PostEnrollmentBodySchema`/`WelcomePostEnrollmentBodySchema` `pid`→`oid`. Update `ResolveActivePeriodParamsSchema` import (`programKey: programKeySchema`). Import from `./offering`.

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/enrollment.ts packages/shared-domain/src/setu/schemas/__tests__/enrollment.test.ts
git commit -m "feat(shared-domain): generalize enrollment (oid, enrolledMids, programKey, nullable location)"
```

### Task A4: Relax `level.ts` + `class-calendar.ts`

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/level.ts`, `schemas/class-calendar.ts`
- Test: existing `level` tests stay green; add one nullable-location case.

- [ ] **Step 1: Edit both schemas** — replace `import { PROGRAM_KEYS, LOCATIONS } from './donation-period'` → `import { programKeySchema, LOCATIONS } from './offering'`; change every `programKey: z.enum(PROGRAM_KEYS)` → `programKey: programKeySchema`; change `location: z.enum(LOCATIONS)` → `location: z.enum(LOCATIONS).nullable()` in the *Doc* schemas (keep create-form location required where the form always supplies it — i.e. leave `CreateLevelSchema.location` required, `CreateCalendarEntryInput.location` required; only the stored `*DocSchema.location` becomes nullable). For `class-calendar.ts` line 52 `programKey: z.enum(PROGRAM_KEYS).default('bala-vihar')` → `programKey: programKeySchema.default('bala-vihar')`.

- [ ] **Step 2: Add nullable-location assertion** to `level.test.ts`:

```ts
it('LevelDoc accepts null location (location-less program)', () => {
  // build a minimal valid LevelDoc with location: null and expect success
});
```
(Fill with a complete object mirroring the existing valid-LevelDoc fixture in that test file, with `location: null`.)

- [ ] **Step 3: Run shared-domain tests.** `pnpm --filter @cmt/shared-domain test` → PASS (all existing + new).

- [ ] **Step 4: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/level.ts packages/shared-domain/src/setu/schemas/class-calendar.ts packages/shared-domain/src/setu/schemas/__tests__/level.test.ts
git commit -m "feat(shared-domain): relax level/calendar programKey to dynamic + nullable location"
```

---

## Phase B — Portal service layer

### Task B1: `programs` service (cached read + assertion)

**Files:**
- Create: `apps/portal/src/features/setu/programs/get-programs.ts`
- Test: `apps/portal/src/features/setu/programs/__tests__/get-programs.test.ts`

- [ ] **Step 1: Write failing test** — mock `portalFirestore` and `next/cache` (per `feedback_e2e_mock_revalidatetag` + the `getFamilyByFid` test pattern). Assert `getProgram('bala-vihar')` maps a Firestore doc → `ProgramDoc`; `getProgram('missing')` → `null`; `assertProgramActive` throws for `draft`/missing and resolves for `active`. Use the exact mock shape from `apps/portal/src/features/setu/members/__tests__` (mirror that file).

```ts
vi.mock('next/cache', () => ({ unstable_cacheTag: vi.fn(), unstable_cacheLife: vi.fn() }));
// mock portalFirestore().collection('programs').doc(key).get() / .collection('programs').get()
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
import { unstable_cacheTag as cacheTag, unstable_cacheLife as cacheLife } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { ProgramDoc } from '@cmt/shared-domain';

function toDate(v: unknown): Date { /* same toDate as get-enrollments.ts */ }
function docToProgram(d: FirebaseFirestore.DocumentData): ProgramDoc { /* map all fields, dates via toDate */ }

export async function getProgram(programKey: string): Promise<ProgramDoc | null> {
  'use cache';
  cacheTag('programs', `program-${programKey}`);
  cacheLife('family');
  const snap = await portalFirestore().collection('programs').doc(programKey).get();
  return snap.exists ? docToProgram(snap.data()!) : null;
}

export async function listPrograms(): Promise<ProgramDoc[]> {
  'use cache';
  cacheTag('programs');
  cacheLife('family');
  const snap = await portalFirestore().collection('programs').orderBy('displayOrder', 'asc').get();
  return snap.docs.map((d) => docToProgram(d.data()));
}

export async function assertProgramActive(programKey: string): Promise<ProgramDoc> {
  const p = await getProgram(programKey);
  if (!p || p.status !== 'active') throw new Error('program-not-available');
  return p;
}
```

- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(programs): cached getProgram/listPrograms/assertProgramActive`.

### Task B2: `getOpenOfferings` (replaces `resolveActivePeriod`)

**Files:**
- Create: `apps/portal/src/features/setu/enrollment/get-open-offerings.ts`
- Delete: `apps/portal/src/features/setu/enrollment/resolve-active-period.ts` (after consumers updated in Phase D/F)
- Test: `apps/portal/src/features/setu/enrollment/__tests__/get-open-offerings.test.ts`

- [ ] **Step 1: Write failing test** — mock firestore; assert it returns ALL `enabled` offerings with `endDate == null || endDate >= now` for a `programKey` (optionally filtered by `location`), sorted by `startDate`; excludes disabled and past-ended.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { OfferingDoc, Location } from '@cmt/shared-domain';

export type OpenOffering = OfferingDoc;

export async function getOpenOfferings(params: { programKey: string; location?: Location | null }): Promise<OpenOffering[]> {
  const now = new Date();
  let q = portalFirestore().collection('offerings')
    .where('programKey', '==', params.programKey)
    .where('enabled', '==', true);
  if (params.location !== undefined) q = q.where('location', '==', params.location);
  const snap = await q.orderBy('startDate', 'asc').get();
  return snap.docs
    .map((d) => docToOffering(d.data())) // mirror rawToPeriod in get-enrollments.ts
    .filter((o) => o.endDate == null || o.endDate >= now);
}
```
(`docToOffering` mirrors `rawToPeriod` from `get-enrollments.ts`, but `endDate` nullable.)

- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(enrollment): getOpenOfferings (list; enabled=enrollment-open)`.

### Task B3: Repoint `get-enrollments.ts` + `enroll-family.ts`

**Files:**
- Modify: `apps/portal/src/features/setu/enrollment/get-enrollments.ts`, `enroll-family.ts`
- Test: update `apps/portal/src/app/api/setu/__tests__/enrollment-integration.test.ts`

- [ ] **Step 1: Edit `get-enrollments.ts`** — collection `donationPeriods` → `offerings`; key `e.pid` → `e.oid`; `rawToPeriod` → `docToOffering` (nullable endDate); type `EnrollmentWithPeriod` → keep name but `period: OfferingDoc | null` (rename to `offering` for clarity; update consumers). Field reads use `enrolledMids`/`oid`/`termLabel`.

- [ ] **Step 2: Edit `enroll-family.ts`** — read the chosen `offering` by `oid`; write enrollment with `oid`, `programKey`, `termLabel`, `enrolledMids` (eligible members for the program; for BV = children, preserving current behavior), `location` from offering. Snapshot suggested amount only when the program `usesDonation` (else 0/null).

- [ ] **Step 3: Update enrollment integration test** to the new fields; run `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/__tests__/enrollment-integration.test.ts`.

- [ ] **Step 4: Run, verify pass. Step 5: Commit** `refactor(enrollment): read offerings by oid; enrolledMids`.

---

## Phase C — Migration (UAT-only)

### Task C1: `migrate-to-programs.ts`

**Files:**
- Create: `apps/portal/scripts/migrate-to-programs.ts`
- Modify: `apps/portal/package.json` (alias `"migrate:programs": "tsx --env-file=.env.local scripts/migrate-to-programs.ts"`)

- [ ] **Step 1: Implement the script** (mirror `migrate-legacy-families.ts` conventions: refuses prod unless `--allow-prod`, `--dry-run`, idempotent, `main().then(()=>process.exit(0))`).

Behavior:
1. Refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'` (or `--allow-prod`).
2. **Seed** `programs/bala-vihar` with `.set(..., { merge: true })`:
   `{ programKey:'bala-vihar', label:'Bala Vihar', shortDescription:'Sunday Bala Vihar classes', status:'active', locations:['Brampton','Mississauga','Scarborough','Markham'], termType:'term', eligibility:{memberType:'child'}, capabilities:{usesOfferings:true,usesDonation:true,usesLevels:true,usesCalendar:true,attendanceMode:'check-in'}, displayOrder:0, createdAt/updatedAt: serverTimestamp, createdBy/updatedBy:'migration' }`.
3. **Offerings:** for each `donationPeriods/*` doc, write `offerings/{pid}` (same id) with `termLabel = periodLabel`, `termType:'term'`, fields copied, `location` kept. Idempotent via `.set(..., {merge:true})`. (Leave the old `donationPeriods` docs in place for rollback; a later cleanup task removes them.)
4. **Enrollments:** iterate `families/*`, for each `families/{fid}/enrollments/*` doc, write back `{ oid: data.pid, programKey:'bala-vihar', termLabel: data.periodLabel, enrolledMids: data.childrenMids }` (merge); leave old fields for rollback.
5. Print counts; honor `--dry-run` (read + log, no writes).

- [ ] **Step 2: Dry-run in UAT**

Run: `pnpm --filter @cmt/portal migrate:programs -- --dry-run`
Expected: logs `programs: would seed bala-vihar`, `offerings: N`, `enrollments: M`, no writes.

- [ ] **Step 3: Real run in UAT**

Run: `pnpm --filter @cmt/portal migrate:programs`
Expected: `Done. program seeded, offerings=N, enrollments=M`.

- [ ] **Step 4: Commit** `chore(scripts): migrate-to-programs (UAT seed + donationPeriods->offerings + enrollment fields)`.

---

## Phase D — API routes

### Task D1: Programs admin API

**Files:**
- Create: `apps/portal/src/app/api/admin/programs/route.ts` (GET list, POST create), `apps/portal/src/app/api/admin/programs/[key]/route.ts` (PATCH).
- Test: `apps/portal/src/app/api/admin/programs/__tests__/route.test.ts`

Gating: covered by the existing `/api/admin/` catch-all (`isAdmin`) in `can-access-route.ts` — no change needed.

- [ ] **Step 1: Write failing route test** (mirror `admin/donation-periods/__tests__/route.test.ts`): 403 for non-admin; POST validates `CreateProgramSchema`, writes `programs/{programKey}` via `.create()` (409 on ALREADY_EXISTS code 6), revalidates `programs` tag; PATCH updates + revalidates `program-${key}` + `programs`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement both routes** — `readSessionFromHeaders` + `isAdmin`; `revalidateTag('programs')` / `revalidateTag(\`program-${key}\`)` after writes; `programKey` slug = `toSafeSlug(label)` if not supplied. Use `FieldValue.serverTimestamp()`.
- [ ] **Step 4: Run test → PASS. Step 5: Commit** `feat(api): admin programs CRUD`.

### Task D2: Rename `donation-periods` API → `offerings`

**Files:**
- Rename dir: `apps/portal/src/app/api/admin/donation-periods/` → `apps/portal/src/app/api/admin/offerings/` (incl. `[pid]` → `[oid]`, and `__tests__`).
- Modify: both route files.

- [ ] **Step 1: `git mv` the directory**, rename `[pid]`→`[oid]`.
- [ ] **Step 2: Edit `offerings/route.ts`** — collection `donationPeriods`→`offerings`; `CreateDonationPeriodSchema`→`CreateOfferingSchema`; `periodLabel`→`termLabel`; id `oid = ${toSafeSlug(programKey)}-${location? toSafeSlug(location):'all'}-${toSafeSlug(termLabel)}`; `programLabel` from `getProgram(programKey)` (fallback to programKey); store `termType`, nullable `location`/`endDate`. Remove the hardcoded `PROGRAM_LABELS` map. Overlap check only when `location != null`.
- [ ] **Step 3: Edit `offerings/[oid]/route.ts`** (PATCH) — collection + `UpdateOfferingSchema` + `termLabel`.
- [ ] **Step 4: Update the test** to the offerings shape; run it.
- [ ] **Step 5: Commit** `refactor(api): donation-periods -> offerings`.

### Task D3: Generalize family + welcome enrollment routes; new family programs list

**Files:**
- Modify: `apps/portal/src/app/api/setu/enrollments/route.ts`, `welcome/enrollments/route.ts`.
- Create: `apps/portal/src/app/api/setu/programs/route.ts` (family-facing eligible-programs list).
- Modify: `packages/shared-domain/src/auth/can-access-route.ts` (open `/api/setu/programs` GET to family + welcome-team).
- Test: extend the enrollment integration test; add a `can-access-route` test case.

- [ ] **Step 1: `can-access-route.ts`** — before the `/api/setu/` catch-all, add:
```ts
if (pathname === '/api/setu/programs' || pathname.startsWith('/api/setu/programs/')) {
  return isSetuFamily(claims) || isWelcomeTeam(claims);
}
```
Add a unit test asserting a `family-member` GET is allowed and an unauth is not.
- [ ] **Step 2: `setu/enrollments/route.ts`** — body `{ oid }` (was `{ pid }`); call `assertProgramActive(offering.programKey)`; pass through to `enroll-family`. Keep `enrolledByMid`/manager checks.
- [ ] **Step 3: `setu/programs/route.ts`** — GET returns `listPrograms()` filtered to `status==='active'` that have ≥1 open offering for the family's location (via `getOpenOfferings`), each with its open offerings. Read fid from headers.
- [ ] **Step 4: `welcome/enrollments/route.ts`** — `pid`→`oid`.
- [ ] **Step 5: Run integration + route tests → PASS. Step 6: Commit** `feat(api): program-aware enroll + family programs list`.

### Task D4: Repoint donations checkout

**Files:** Modify `apps/portal/src/app/api/setu/donations/checkout/route.ts`; test `checkout/__tests__/route.test.ts`.

- [ ] **Step 1: Edit** — the bala-vihar branch reads the enrollment's `oid`/offering (via `getEnrollments`) instead of `pid`/period; `checkoutLineItemName('bala-vihar', enrollment.offering?.termLabel)`. Keep behavior identical for BV.
- [ ] **Step 2: Update the checkout test** field names; run it.
- [ ] **Step 3: Commit** `refactor(donations): checkout reads offering`.

---

## Phase E — Admin UX (hybrid IA)

### Task E1: `/admin/programs` hub (list + editor)

**Files:**
- Create: `apps/portal/src/app/admin/programs/page.tsx`, `apps/portal/src/app/admin/programs/[key]/page.tsx`
- Create: `apps/portal/src/features/admin/programs/programs-table.tsx` (`'use client'` list + create), `program-form.tsx` (editor)
- Modify: `apps/portal/src/app/admin/page.tsx` (add a Programs tile), `apps/portal/src/features/admin/components/admin-mobile-nav.tsx` (point a slot at `/admin/programs`)
- Test: `apps/portal/src/features/admin/programs/__tests__/programs-table.test.tsx`, `program-form.test.tsx`

- [ ] **Step 1: Component test** (mirror `periods-table.test.tsx`): list renders programs with status badges (use `getAllByText` for any text duplicated across mobile+desktop, per `feedback_csp_token_scoping`/dual-render); create form POSTs `CreateProgramSchema` body; editor PATCHes only changed fields. Follow the mobile card + `.csp` patterns from `periods-table.tsx`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the hub page (server: `listPrograms()` serialized), `programs-table` (rows: label, status, capability badges, displayOrder; +New), `program-form` (all `ProgramDoc` fields incl. locations multi-select, eligibility, capability toggles, attendanceMode, status). Page wrapped by the admin layout (already CspRoot + AdminMobileNav). Add the `/admin/page.tsx` tile (`icon:'people'`/new) and an AdminMobileNav entry.
- [ ] **Step 4: Run tests → PASS. Step 5: Commit** `feat(admin): programs hub (list + editor)`.

### Task E2: Per-program offerings panel + Duplicate

**Files:**
- Create: `apps/portal/src/features/admin/programs/offerings-panel.tsx` (the renamed periods-table, scoped to a program, fetching `/api/admin/offerings`).
- Modify: `apps/portal/src/app/admin/programs/[key]/page.tsx` (render the offerings panel under the program).
- Remove/redirect: `apps/portal/src/app/admin/donation-periods/page.tsx` → redirect to `/admin/programs` (the offerings now live per-program).
- Test: `offerings-panel.test.tsx` (adapt `periods-table.test.tsx`).

- [ ] **Step 1: Test** — panel lists the program's offerings (mobile cards + desktop table, as already built); "Duplicate offering" prefills the create modal from a chosen offering (dates shifted +1 year, pricing carried). Use `getAllByText` for dual-rendered text.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** by moving `features/admin/donation-periods/periods-table.tsx` content into `offerings-panel.tsx`, parameterized by `programKey`; fetch `/api/admin/offerings?programKey=`; add a Duplicate action. Keep the mobile/desktop split + `.csp` already built.
- [ ] **Step 4: Run tests → PASS. Step 5: Commit** `feat(admin): per-program offerings panel + duplicate`.

### Task E3: Levels + Calendar gain a program filter

**Files:** Modify `apps/portal/src/app/admin/levels/page.tsx`, `features/admin/levels/levels-table.tsx`, `apps/portal/src/app/admin/calendar/page.tsx`, `features/admin/calendar/calendar-editor.tsx`. Modify the levels/calendar admin GET routes to accept `programKey`.

- [ ] **Step 1: Test** — `levels-table`/`calendar-editor` render a program `<select>` (default `bala-vihar`) alongside the existing location filter, and refetch on change. Add to existing component tests.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add a program dropdown (options = `listPrograms()` where `usesLevels`/`usesCalendar`), thread `programKey` into the fetch + create calls (default `bala-vihar` keeps BV unchanged).
- [ ] **Step 4: Run tests → PASS. Step 5: Commit** `feat(admin): program filter on levels + calendar`.

---

## Phase F — Family UX (foundation)

### Task F1: Dashboard per-program cards

**Files:** Modify `apps/portal/src/app/family/page.tsx`. Test: there is no existing page test; add `apps/portal/src/app/family/__tests__/dashboard-cards.test.tsx` covering the card-derivation helper.

- [ ] **Step 1: Extract + test a pure helper** `deriveProgramCards(enrollments, programsById)` → one card per active enrollment `{ programLabel, termLabel, status, showAttendance, showDonation }` driven by the program's capabilities. Test: BV enrollment yields a card with `showAttendance` (check-in) + `showDonation`; a free location-less program yields neither.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the helper + render a card per enrollment (BV's existing card is the `bala-vihar` case, visually unchanged). Keep the legacy-payment/attendance code under the BV card path.
- [ ] **Step 4: Run test + a manual BV check. Step 5: Commit** `feat(family): per-program dashboard cards`.

### Task F2: Parameterized `/family/enroll/[programKey]`

**Files:**
- Create: `apps/portal/src/app/family/enroll/[programKey]/page.tsx` (from current `enroll/page.tsx`).
- Modify/redirect: `apps/portal/src/app/family/enroll/page.tsx` → redirect to `/family/enroll/bala-vihar` (preserves the existing nav/links).
- Test: `apps/portal/src/features/family/components/__tests__/enroll-flow.test.tsx` (adapt existing enroll tests if any; else add a component test for the offering picker + eligible-member filter).

- [ ] **Step 1: Test** — given a program with 2 open offerings, the page shows an offering picker; eligible members are filtered by `memberEligibleForProgram`; the dakshina step renders only when `program.capabilities.usesDonation`. For `bala-vihar` with one open offering, it auto-selects (BV unchanged).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `getProgram(params.programKey)` + `getOpenOfferings`; render offering picker (auto-select when one), eligible-member list (filtered), optional dakshina (only `usesDonation`), submit posts `{ oid }` to `/api/setu/enrollments`. The current BV enroll page becomes the `programKey='bala-vihar'` render.
- [ ] **Step 4: Run tests + manual BV walkthrough. Step 5: Commit** `feat(family): parameterized program enroll`.

### Task F3: Minimal eligible-programs list

**Files:** Create `apps/portal/src/app/family/programs/page.tsx`; client fetch wrapper `apps/portal/src/features/family/data/programs-client.ts` (per `feedback_client_server_boundary`). Test: `programs-client` + a component render test.

- [ ] **Step 1: Test** — the page lists active programs the family is eligible for with an open offering, each linking to `/family/enroll/[programKey]`; empty state when none.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — server page calls `/api/setu/programs` data (or the service directly), renders cards (program label, short description, term, "Enroll" link). Follow the family mobile card + bottom-nav patterns. (No nav restructure — that's sub-spec ②; reach this via a dashboard link.)
- [ ] **Step 4: Run tests → PASS. Step 5: Commit** `feat(family): eligible-programs list`.

---

## Phase G — Indexes, regression, walkthrough

### Task G1: Firestore `offerings` index

**Files:** Modify `firestore.indexes.json`.

- [ ] **Step 1: Add** an `offerings` composite mirroring the `donationPeriods` one:
```json
{ "collectionGroup": "offerings", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "enabled", "order": "ASCENDING" },
  { "fieldPath": "location", "order": "ASCENDING" },
  { "fieldPath": "programKey", "order": "ASCENDING" },
  { "fieldPath": "startDate", "order": "ASCENDING" } ] }
```
(Also add a `programKey + enabled + startDate` variant for the location-less query path if `getOpenOfferings` runs without a location filter.)
- [ ] **Step 2: Deploy to UAT only**

Run: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`
Expected: indexes created. **Never** run with `--project chinmaya-setu-715b8 --force`.
- [ ] **Step 3: Commit** `chore(firestore): offerings index`.

### Task G2: Regression — repoint remaining reads + E2E

**Files:** Sweep the remaining `donationPeriods` / `pid` / `childrenMids` / `periodLabel` references; update E2E (`apps/portal/src/__tests__/e2e/enrollments.e2e.test.ts`, `donation-periods.e2e.test.ts`).

- [ ] **Step 1:** `grep -rn "donationPeriods\|resolveActivePeriod\|childrenMids\|\.pid\b" apps/portal/src` — fix each site to offerings/oid/enrolledMids/getOpenOfferings. Delete `resolve-active-period.ts`.
- [ ] **Step 2:** Update + run the E2E suite: `pnpm --filter @cmt/portal test:e2e` (rename `donation-periods.e2e` → `offerings.e2e`).
- [ ] **Step 3:** Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green.
- [ ] **Step 4: Commit** `refactor: repoint all reads to offerings; update e2e`.

### Task G3: Mock-free UAT walkthrough (acceptance)

- [ ] **Step 1:** In UAT admin, create a **Test Tabla** program: `status:active`, `locations:[]` (online), `termType:rolling`, `eligibility:{memberType:'any'}`, `capabilities:{usesOfferings:true, usesDonation:false, usesLevels:false, usesCalendar:false, attendanceMode:'none'}`. Add one open offering.
- [ ] **Step 2:** As a family, open `/family/programs`, enroll an **adult** in Test Tabla; confirm a dashboard card appears (no donation/attendance).
- [ ] **Step 3:** Re-run the BV path: enroll a child in `bala-vihar`, complete a Stripe donation, confirm the dashboard/receipt — **identical to today**.
- [ ] **Step 4:** Record results in the PR description (distinguish "tests pass" vs "UAT-verified", per CLAUDE.md pre-ship discipline). Delete the Test Tabla program when done.

---

## Notes for the executor
- **Mobile-responsive is a DoD gate (cross-cutting #1):** no UI task is complete until verified at 390px with the `block md:hidden`/`hidden md:block` + `.csp` patterns.
- **APIs are the native app's backend (cross-cutting #2):** keep handlers identity-source-agnostic (bearer + cookie via `readSessionFromHeaders`), JSON+ISO, validated by shared-domain Zod; never add web-only coupling.
- **DRY/YAGNI:** reuse `periods-table.tsx`'s mobile/desktop card pattern for offerings; do not rebuild it.
- **`.csp` token scoping** and **dual mobile+desktop render** (use `getAllByText`) are recurring gotchas — see the relevant memory notes.
- **Never** assign `undefined` to optional props (`exactOptionalPropertyTypes` is on) — use conditional spreads.
- **Always push after commit**; the pre-push hook is the gate; never `--no-verify`.
- BV-identical is the acceptance bar — if any BV test changes meaning, stop and reconcile.
