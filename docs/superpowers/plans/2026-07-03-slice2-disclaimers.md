# Slice 2 — Family Disclaimers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the end of the family sign-in/sign-up flow with an admin-editable, version-tracked disclaimer acceptance screen that re-prompts on admin edit or a new school year.

**Architecture:** A flag-gated `DisclaimerGate` server component in the `/family` layout (mirroring the existing `ProfileCompletionGate`) `redirect()`s a manager whose acceptance isn't current to a top-level `/disclaimers` accept screen. Content is an admin-editable `app_config/disclaimers` doc (exact analog of `app_config/school_year`); acceptance is a `families/{fid}.disclaimersAccepted` record validated against `(currentSchoolYear, contentVersion)`. Pure schema + predicate live in `@cmt/shared-domain`; all Firestore I/O lives in a new portal feature module.

**Tech Stack:** Next.js 16 (App Router, Server Components, Cache Components), TypeScript (strict + exactOptionalPropertyTypes), Zod, Firebase Admin (Firestore), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-03-slice2-disclaimers-design.md`.

## Global Constraints

- **Flag OFF by default.** `flags.setuDisclaimers` = literal `process.env.NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS === 'true'` (never dynamic index). Register the var in `turbo.json`'s `env` array. The family GATE, the `/disclaimers` route, and the dashboard `disclaimersPending` field are all flag-gated. The `/admin/disclaimers` editor is admin-only and available regardless of the flag.
- **Accept scope = per family, MANAGER accepts.** The gate runs for the family-manager only; family-members are not gated. Acceptance stored once per family on `families/{fid}.disclaimersAccepted`.
- **Version model = school-year + content version.** Accepted iff `saved.schoolYear === currentYear && saved.version >= config.version`. School-year label format is `YYYY-YY` (e.g. `2026-27`) from `app_config/school_year.currentYear`. Content `version` is a positive int bumped on each admin publish that changes content.
- **UAT only** (`chinmaya-setu-uat`); never prod `715b8`. **No new Firestore composite index** (all reads are single-doc). **Never bypass `--no-verify`.** **Push after the batch** (single push after Task 11, before the owner E2E gate).
- **`exactOptionalPropertyTypes` is on** — never assign `undefined` to an optional; omit the key or use `null`.
- **Doc read-schemas: no `.min(1)` on content fields.** Non-empty titles/bodies are enforced at the admin write route + editor form, NOT the read schema.
- **`@cmt/shared-domain` stays pure** — no React/Next/Firestore imports there.
- **Leave `/disclaimers` via a HARD nav** — the accept button POSTs then calls `navigateTo('/family')` (`window.location.assign`), never `router.push`.
- **All subagents run on Opus.**

---

### Task 1: Shared-domain schemas, seed default, and predicate

**Files:**
- Create: `packages/shared-domain/src/setu/schemas/disclaimers.ts`
- Create: `packages/shared-domain/src/setu/disclaimers.ts`
- Modify: `packages/shared-domain/src/setu/schemas/family.ts` (add `disclaimersAccepted` field)
- Modify: `packages/shared-domain/src/setu/index.ts` (add two `export *` lines)
- Test: `packages/shared-domain/src/setu/__tests__/disclaimers.test.ts`

**Interfaces:**
- Produces: `DisclaimerSectionSchema`, `DisclaimersConfigSchema`, `DisclaimerAcceptanceSchema` and types `DisclaimerSection`, `DisclaimersConfig`, `DisclaimerAcceptance`; `DEFAULT_DISCLAIMERS_CONFIG: DisclaimersConfig`; `isDisclaimerAccepted(accepted, config, currentYear): boolean`. `FamilyDoc` gains `disclaimersAccepted?: DisclaimerAcceptance | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared-domain/src/setu/__tests__/disclaimers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DisclaimersConfigSchema,
  DEFAULT_DISCLAIMERS_CONFIG,
  isDisclaimerAccepted,
} from '../disclaimers';

describe('DEFAULT_DISCLAIMERS_CONFIG', () => {
  it('is a valid config with version 1 and four seed sections', () => {
    const parsed = DisclaimersConfigSchema.safeParse(DEFAULT_DISCLAIMERS_CONFIG);
    expect(parsed.success).toBe(true);
    expect(DEFAULT_DISCLAIMERS_CONFIG.version).toBe(1);
    expect(DEFAULT_DISCLAIMERS_CONFIG.sections).toHaveLength(4);
    expect(DEFAULT_DISCLAIMERS_CONFIG.sections.map((s) => s.id)).toEqual([
      'respect-responsibility',
      'sacred-spaces',
      'community-values',
      'chinmaya-values',
    ]);
  });
});

describe('isDisclaimerAccepted', () => {
  const config = { version: 3 };
  const YEAR = '2026-27';

  it('true when year matches and version >= current', () => {
    expect(isDisclaimerAccepted({ schoolYear: '2026-27', version: 3 }, config, YEAR)).toBe(true);
    expect(isDisclaimerAccepted({ schoolYear: '2026-27', version: 4 }, config, YEAR)).toBe(true);
  });
  it('false when the accepted version is older than current', () => {
    expect(isDisclaimerAccepted({ schoolYear: '2026-27', version: 2 }, config, YEAR)).toBe(false);
  });
  it('false when the accepted school year differs (yearly reset)', () => {
    expect(isDisclaimerAccepted({ schoolYear: '2025-26', version: 3 }, config, YEAR)).toBe(false);
  });
  it('false when there is no acceptance record', () => {
    expect(isDisclaimerAccepted(null, config, YEAR)).toBe(false);
    expect(isDisclaimerAccepted(undefined, config, YEAR)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/disclaimers.test.ts`
Expected: FAIL — cannot resolve `../disclaimers`.

- [ ] **Step 3: Create the schemas file**

Create `packages/shared-domain/src/setu/schemas/disclaimers.ts`:

```ts
import { z } from 'zod';

// One disclaimer section. Read-schema — NO .min() on title/body (doc schemas
// validate on READ; non-empty is enforced at the admin write route + editor).
export const DisclaimerSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});
export type DisclaimerSection = z.infer<typeof DisclaimerSectionSchema>;

// The admin-editable content doc (app_config/disclaimers). version is a positive
// int bumped on each publish that changes content. updatedAt/updatedBy are
// write-only bookkeeping, optional on read.
export const DisclaimersConfigSchema = z.object({
  version: z.number().int().positive(),
  sections: z.array(DisclaimerSectionSchema),
  updatedAt: z.unknown().optional(),
  updatedBy: z.string().optional(),
});
export type DisclaimersConfig = z.infer<typeof DisclaimersConfigSchema>;

// The per-family acceptance record surfaced on the FamilyDoc. acceptedAt (a
// Firestore Timestamp) is written by the record helper but intentionally NOT
// surfaced here — the predicate only needs schoolYear + version.
export const DisclaimerAcceptanceSchema = z.object({
  schoolYear: z.string(),
  version: z.number().int(),
  acceptedByMid: z.string(),
});
export type DisclaimerAcceptance = z.infer<typeof DisclaimerAcceptanceSchema>;
```

- [ ] **Step 4: Create the default + predicate file**

Create `packages/shared-domain/src/setu/disclaimers.ts`:

```ts
import type { DisclaimersConfig } from './schemas/disclaimers';

// Seed content shown before any admin edit (getDisclaimersConfig falls back to
// this when app_config/disclaimers is absent). DRAFT copy — admin-editable at
// /admin/disclaimers. Section ids are stable and must not change.
export const DEFAULT_DISCLAIMERS_CONFIG: DisclaimersConfig = {
  version: 1,
  sections: [
    {
      id: 'respect-responsibility',
      title: 'Respect & Responsibility',
      body:
        'We treat every sevak, teacher, family, and child with kindness and respect. We arrive on time, follow the guidance of teachers and volunteers, and take responsibility for our children’s conduct while on Mission premises.',
    },
    {
      id: 'sacred-spaces',
      title: 'Care for Sacred Spaces',
      body:
        'Chinmaya Mission’s halls, shrines, and grounds are sacred. We remove footwear where required, keep spaces clean, handle sacred images and materials with reverence, and help leave every room better than we found it.',
    },
    {
      id: 'community-values',
      title: 'Community Values',
      body:
        'Our community runs on seva (selfless service). Each family commits to contributing at least 20 hours of seva per school year — helping with events, classes, kitchen, setup, or other needs — and to participating in the life of the Mission beyond the classroom.',
    },
    {
      id: 'chinmaya-values',
      title: 'Acknowledgement of Chinmaya Values',
      body:
        'We understand that Chinmaya Mission Toronto is a Hindu spiritual and cultural organization rooted in the teachings of Pujya Gurudev Swami Chinmayananda, and we acknowledge and support the Mission’s values and the spiritual nature of its programs.',
    },
  ],
};

/**
 * True when a family's stored acceptance is current: same school year AND a
 * version at least the current content version. Absent/stale ⇒ must re-accept.
 * Pure — shared by the /family gate, GET /api/setu/disclaimers, and the mobile
 * dashboard so they never diverge.
 */
export function isDisclaimerAccepted(
  accepted: { schoolYear: string; version: number } | null | undefined,
  config: { version: number },
  currentYear: string,
): boolean {
  return (
    !!accepted && accepted.schoolYear === currentYear && accepted.version >= config.version
  );
}
```

- [ ] **Step 5: Add `disclaimersAccepted` to the FamilyDoc schema**

In `packages/shared-domain/src/setu/schemas/family.ts`, add the import at the top and the field inside `FamilyDocSchema` (after `publicFid`):

```ts
import { z } from 'zod';
import { DisclaimerAcceptanceSchema } from './disclaimers';

export const FamilyDocSchema = z.object({
  fid: z.string().min(1),
  legacyFid: z.string().nullable(),
  name: z.string().min(1),
  location: z.enum(['Brampton', 'Mississauga', 'Scarborough', 'Markham']),
  createdAt: z.date(),
  managers: z.array(z.string()).min(1),
  searchKeys: z.array(z.string()),
  publicFid: z.string().nullable().optional(),
  // Slice 2: version-tracked disclaimer acceptance (per-family; the manager
  // accepts). Optional + nullable — absence reads as "never accepted".
  disclaimersAccepted: DisclaimerAcceptanceSchema.nullable().optional(),
});

export type FamilyDoc = z.infer<typeof FamilyDocSchema>;
```

- [ ] **Step 6: Export from the setu barrel**

In `packages/shared-domain/src/setu/index.ts`, add after the existing `export * from './schemas/rollover';` line (order among schema exports doesn't matter, but keep `./schemas/disclaimers` grouped with the other schema exports and `./disclaimers` with the non-schema modules):

```ts
export * from './schemas/disclaimers';
export * from './disclaimers';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/disclaimers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Typecheck the package**

Run: `pnpm --filter @cmt/shared-domain typecheck`
Expected: no errors (confirms the family.ts ↔ disclaimers.ts import + exactOptionalPropertyTypes are clean).

- [ ] **Step 9: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/disclaimers.ts packages/shared-domain/src/setu/disclaimers.ts packages/shared-domain/src/setu/schemas/family.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/__tests__/disclaimers.test.ts
git commit -m "feat(disclaimers): shared-domain schemas, seed default, acceptance predicate"
```

---

### Task 2: Feature flag + turbo.json passthrough

**Files:**
- Modify: `apps/portal/src/lib/flags.ts` (add `setuDisclaimers`)
- Modify: `turbo.json` (add `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS` to the `env` array)
- Test: `apps/portal/src/lib/__tests__/flags-disclaimers.test.ts`

**Interfaces:**
- Produces: `flags.setuDisclaimers: boolean` (false unless the env var is exactly `'true'`).

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/lib/__tests__/flags-disclaimers.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('flags.setuDisclaimers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is false when the env var is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS', '');
    const { flags } = await import('../flags');
    expect(flags.setuDisclaimers).toBe(false);
  });

  it('is true only when the env var is exactly "true"', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS', 'true');
    const { flags } = await import('../flags');
    expect(flags.setuDisclaimers).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/lib/__tests__/flags-disclaimers.test.ts`
Expected: FAIL — `flags.setuDisclaimers` is `undefined`, not `false`/`true`.

- [ ] **Step 3: Add the flag**

In `apps/portal/src/lib/flags.ts`, add inside the `flags` object after the `setuPrasad` line:

```ts
  // Slice 2 (2026-07-03): family disclaimers accept-all gate. OFF by default —
  // ships dark; flip on at launch. Gates the /family DisclaimerGate, the
  // /disclaimers route, and the dashboard disclaimersPending field. The
  // /admin/disclaimers editor is admin-only and available regardless of this flag.
  setuDisclaimers: process.env.NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS === 'true',
```

- [ ] **Step 4: Register the env var in turbo.json**

In `turbo.json`, add `"NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS"` to the `env` array, next to `NEXT_PUBLIC_FEATURE_SETU_SEVA` / `NEXT_PUBLIC_FEATURE_SETU_PRASAD` (Turborepo strips env from the Vercel build sandbox otherwise, so the client bundle would inline `false`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/lib/__tests__/flags-disclaimers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/lib/flags.ts turbo.json apps/portal/src/lib/__tests__/flags-disclaimers.test.ts
git commit -m "feat(disclaimers): add setuDisclaimers flag (OFF default) + turbo passthrough"
```

---

### Task 3: Config read/write helper

**Files:**
- Create: `apps/portal/src/features/setu/disclaimers/config.ts`
- Test: `apps/portal/src/features/setu/disclaimers/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `DisclaimersConfigSchema`, `DEFAULT_DISCLAIMERS_CONFIG`, `DisclaimerSection` (Task 1); `FieldValue` from `@cmt/firebase-shared/admin/firestore`.
- Produces:
  - `getDisclaimersConfig(db: FirebaseFirestore.Firestore): Promise<DisclaimersConfig>` — reads `app_config/disclaimers`, safeParse → data or `DEFAULT_DISCLAIMERS_CONFIG`.
  - `setDisclaimersConfig(db, sections: DisclaimerSection[], actorMid: string): Promise<DisclaimersConfig>` — in a transaction, bump `version` (+1) and write when `sections` differ from current; no-op (return current) when identical.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/disclaimers/__tests__/config.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_DISCLAIMERS_CONFIG } from '@cmt/shared-domain/setu';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import { getDisclaimersConfig, setDisclaimersConfig } from '../config';

// Minimal fake Firestore: a single app_config/disclaimers doc + runTransaction.
function fakeDb(initial: Record<string, unknown> | null) {
  let doc = initial;
  const ref = {
    get: async () => ({ exists: doc !== null, data: () => doc }),
    set: async (data: Record<string, unknown>) => {
      doc = { ...(doc ?? {}), ...data };
    },
  };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) =>
      fn({
        get: async () => ({ exists: doc !== null, data: () => doc }),
        set: (_ref: unknown, data: Record<string, unknown>) => {
          doc = { ...(doc ?? {}), ...data };
        },
      }),
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, read: () => doc };
}

const SECTIONS = DEFAULT_DISCLAIMERS_CONFIG.sections;

describe('getDisclaimersConfig', () => {
  it('returns the DEFAULT (version 1) when the doc is absent', async () => {
    const { db } = fakeDb(null);
    const cfg = await getDisclaimersConfig(db);
    expect(cfg.version).toBe(1);
    expect(cfg.sections).toHaveLength(4);
  });

  it('returns the stored config when present and valid', async () => {
    const { db } = fakeDb({ version: 5, sections: SECTIONS });
    const cfg = await getDisclaimersConfig(db);
    expect(cfg.version).toBe(5);
  });

  it('falls back to DEFAULT when the stored doc is invalid', async () => {
    const { db } = fakeDb({ version: 'nope' });
    const cfg = await getDisclaimersConfig(db);
    expect(cfg.version).toBe(1);
  });
});

describe('setDisclaimersConfig', () => {
  it('writes version 2 when publishing changed content over an absent doc', async () => {
    const { db, read } = fakeDb(null);
    const edited = SECTIONS.map((s, i) => (i === 0 ? { ...s, body: 'Edited body.' } : s));
    const result = await setDisclaimersConfig(db, edited, 'mid-admin');
    expect(result.version).toBe(2);
    expect((read() as { version: number }).version).toBe(2);
    expect((read() as { updatedBy: string }).updatedBy).toBe('mid-admin');
  });

  it('bumps version by exactly 1 over an existing doc', async () => {
    const { db } = fakeDb({ version: 7, sections: SECTIONS });
    const edited = SECTIONS.map((s, i) => (i === 0 ? { ...s, title: 'New title' } : s));
    const result = await setDisclaimersConfig(db, edited, 'mid-admin');
    expect(result.version).toBe(8);
  });

  it('does NOT bump when the content is identical (no needless re-prompt)', async () => {
    const { db } = fakeDb({ version: 7, sections: SECTIONS });
    const result = await setDisclaimersConfig(db, SECTIONS, 'mid-admin');
    expect(result.version).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/disclaimers/__tests__/config.test.ts`
Expected: FAIL — cannot resolve `../config`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/src/features/setu/disclaimers/config.ts`:

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  DisclaimersConfigSchema,
  DEFAULT_DISCLAIMERS_CONFIG,
  type DisclaimersConfig,
  type DisclaimerSection,
} from '@cmt/shared-domain/setu';

type Db = FirebaseFirestore.Firestore;

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'disclaimers';

/** Current disclaimers content. Falls back to the seed DEFAULT when the doc is
 *  absent or fails validation, so the feature works before any admin edit. */
export async function getDisclaimersConfig(db: Db): Promise<DisclaimersConfig> {
  const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_DISCLAIMERS_CONFIG };
  const parsed = DisclaimersConfigSchema.safeParse(snap.data());
  return parsed.success ? parsed.data : { ...DEFAULT_DISCLAIMERS_CONFIG };
}

// Compare only the content (id/title/body) — bookkeeping fields never trigger a
// version bump.
function sameSections(a: DisclaimerSection[], b: DisclaimerSection[]): boolean {
  const norm = (xs: DisclaimerSection[]) =>
    JSON.stringify(xs.map((s) => ({ id: s.id, title: s.title, body: s.body })));
  return norm(a) === norm(b);
}

/**
 * Publish new disclaimer content. Bumps `version` by 1 and writes when the
 * sections differ from the current content; a no-op (returns current unchanged)
 * when identical, so re-publishing the same text never forces a needless
 * re-accept. Runs in a transaction so version can't race between two publishes.
 */
export async function setDisclaimersConfig(
  db: Db,
  sections: DisclaimerSection[],
  actorMid: string,
): Promise<DisclaimersConfig> {
  const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const parsed = snap.exists ? DisclaimersConfigSchema.safeParse(snap.data()) : null;
    const current: DisclaimersConfig =
      parsed && parsed.success ? parsed.data : { ...DEFAULT_DISCLAIMERS_CONFIG };

    if (sameSections(current.sections, sections)) return current;

    const next: DisclaimersConfig = { version: current.version + 1, sections };
    txn.set(
      ref,
      {
        version: next.version,
        sections,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorMid,
      },
      { merge: true },
    );
    return next;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/disclaimers/__tests__/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/disclaimers/config.ts apps/portal/src/features/setu/disclaimers/__tests__/config.test.ts
git commit -m "feat(disclaimers): app_config/disclaimers read/write helper (version bump)"
```

---

### Task 4: Acceptance helper + surface the field on the family read

**Files:**
- Create: `apps/portal/src/features/setu/disclaimers/acceptance.ts`
- Modify: `apps/portal/src/features/setu/members/get-family-by-fid.ts` (map `disclaimersAccepted` onto the returned `FamilyDoc`)
- Test: `apps/portal/src/features/setu/disclaimers/__tests__/acceptance.test.ts`

**Interfaces:**
- Consumes: `getDisclaimersConfig` (Task 3); `getSchoolYearConfig` from `@/features/setu/rollover/school-year-config`; `isDisclaimerAccepted`, `DisclaimerSection` (Task 1); `FieldValue`; `FamilyDoc`.
- Produces:
  - `getDisclaimerStateForFamily(db, family: Pick<FamilyDoc,'disclaimersAccepted'>): Promise<{ version: number; schoolYear: string; sections: DisclaimerSection[]; accepted: boolean }>`
  - `recordDisclaimerAcceptance(db, fid: string, input: { version: number; schoolYear: string; byMid: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/disclaimers/__tests__/acceptance.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_DISCLAIMERS_CONFIG } from '@cmt/shared-domain/setu';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));
vi.mock('../config', () => ({
  getDisclaimersConfig: vi.fn(async () => ({ version: 3, sections: DEFAULT_DISCLAIMERS_CONFIG.sections })),
}));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: vi.fn(async () => ({ currentYear: '2026-27' })),
}));

import { getDisclaimerStateForFamily, recordDisclaimerAcceptance } from '../acceptance';

const db = {} as FirebaseFirestore.Firestore;

describe('getDisclaimerStateForFamily', () => {
  it('accepted=true when the family accepted the current year + version', async () => {
    const state = await getDisclaimerStateForFamily(db, {
      disclaimersAccepted: { schoolYear: '2026-27', version: 3, acceptedByMid: 'm1' },
    });
    expect(state.accepted).toBe(true);
    expect(state.version).toBe(3);
    expect(state.schoolYear).toBe('2026-27');
    expect(state.sections).toHaveLength(4);
  });

  it('accepted=false when no acceptance is stored', async () => {
    const state = await getDisclaimerStateForFamily(db, { disclaimersAccepted: null });
    expect(state.accepted).toBe(false);
  });

  it('accepted=false when the stored version is stale', async () => {
    const state = await getDisclaimerStateForFamily(db, {
      disclaimersAccepted: { schoolYear: '2026-27', version: 2, acceptedByMid: 'm1' },
    });
    expect(state.accepted).toBe(false);
  });
});

describe('recordDisclaimerAcceptance', () => {
  it('merges the acceptance record onto families/{fid}', async () => {
    const set = vi.fn(async () => undefined);
    const familyDoc = { set };
    const dbLocal = {
      collection: vi.fn(() => ({ doc: vi.fn(() => familyDoc) })),
    } as unknown as FirebaseFirestore.Firestore;

    await recordDisclaimerAcceptance(dbLocal, 'CMT-1', {
      version: 3,
      schoolYear: '2026-27',
      byMid: 'm1',
    });

    expect(set).toHaveBeenCalledTimes(1);
    const [payload, opts] = set.mock.calls[0];
    expect(payload.disclaimersAccepted).toMatchObject({
      version: 3,
      schoolYear: '2026-27',
      acceptedByMid: 'm1',
      acceptedAt: '__ts__',
    });
    expect(opts).toEqual({ merge: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/disclaimers/__tests__/acceptance.test.ts`
Expected: FAIL — cannot resolve `../acceptance`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/src/features/setu/disclaimers/acceptance.ts`:

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  isDisclaimerAccepted,
  type DisclaimerSection,
  type FamilyDoc,
} from '@cmt/shared-domain/setu';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { getDisclaimersConfig } from './config';

type Db = FirebaseFirestore.Firestore;

export interface DisclaimerState {
  version: number;
  schoolYear: string;
  sections: DisclaimerSection[];
  accepted: boolean;
}

/** The disclaimer state for a specific family: current content + whether this
 *  family's stored acceptance is current. Shared by the gate, GET
 *  /api/setu/disclaimers, and the dashboard so they never diverge. */
export async function getDisclaimerStateForFamily(
  db: Db,
  family: Pick<FamilyDoc, 'disclaimersAccepted'>,
): Promise<DisclaimerState> {
  const [config, schoolYearConfig] = await Promise.all([
    getDisclaimersConfig(db),
    getSchoolYearConfig(db),
  ]);
  const currentYear = schoolYearConfig.currentYear;
  return {
    version: config.version,
    schoolYear: currentYear,
    sections: config.sections,
    accepted: isDisclaimerAccepted(family.disclaimersAccepted ?? null, config, currentYear),
  };
}

/** Record a family's acceptance of the current content version + school year. */
export async function recordDisclaimerAcceptance(
  db: Db,
  fid: string,
  input: { version: number; schoolYear: string; byMid: string },
): Promise<void> {
  await db.collection('families').doc(fid).set(
    {
      disclaimersAccepted: {
        schoolYear: input.schoolYear,
        version: input.version,
        acceptedByMid: input.byMid,
        acceptedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
}
```

- [ ] **Step 4: Surface `disclaimersAccepted` on the family read**

In `apps/portal/src/features/setu/members/get-family-by-fid.ts`, add the field to the hand-mapped `FamilyDoc` object (after `searchKeys: familyData.searchKeys ?? [],`). This is REQUIRED — `getFamilyByFid` constructs the `FamilyDoc` field-by-field (it does NOT spread `familyData`), so without this line the gate would never see the acceptance:

```ts
    searchKeys: familyData.searchKeys ?? [],
    disclaimersAccepted: familyData.disclaimersAccepted
      ? {
          schoolYear: familyData.disclaimersAccepted.schoolYear,
          version: familyData.disclaimersAccepted.version,
          acceptedByMid: familyData.disclaimersAccepted.acceptedByMid,
        }
      : null,
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/disclaimers/__tests__/acceptance.test.ts`
Expected: PASS (4 tests).
Run: `pnpm --filter @cmt/portal typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/disclaimers/acceptance.ts apps/portal/src/features/setu/members/get-family-by-fid.ts apps/portal/src/features/setu/disclaimers/__tests__/acceptance.test.ts
git commit -m "feat(disclaimers): acceptance record + state helper; surface field on family read"
```

---

### Task 5: Route authorization (canAccessRoute + middleware redirect)

**Files:**
- Modify: `packages/shared-domain/src/auth/can-access-route.ts` (add two rules)
- Modify: `apps/portal/src/middleware.ts` (add `/disclaimers` to the `isSetuRoute` deny redirect list)
- Test: `packages/shared-domain/src/__tests__/can-access-route-disclaimers.test.ts`

**Interfaces:**
- Consumes: `isSetuFamily`, `isSetuManager`, `isAdmin` (already imported in can-access-route.ts).
- Produces: `/api/setu/disclaimers*` → any setu family for GET, manager-only for POST; `/disclaimers` page → any setu family. `/admin/disclaimers` + `/api/admin/disclaimers` are already covered by the existing `/admin` + `/api/admin/` admin-only rules.

- [ ] **Step 1: Write the failing test**

Create `packages/shared-domain/src/__tests__/can-access-route-disclaimers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import type { SessionClaims } from '../auth/session';

const manager = { role: 'family-manager', fid: 'CMT-1', mid: 'm1' } as unknown as SessionClaims;
const member = { role: 'family-member', fid: 'CMT-1', mid: 'm2' } as unknown as SessionClaims;
const admin = { role: 'admin', uid: 'u-admin' } as unknown as SessionClaims;
const welcome = { role: 'welcome-team', uid: 'u-w' } as unknown as SessionClaims;

describe('canAccessRoute — disclaimers', () => {
  it('GET /api/setu/disclaimers is any setu family', () => {
    expect(canAccessRoute(manager, '/api/setu/disclaimers', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/disclaimers', 'GET')).toBe(true);
  });
  it('POST /api/setu/disclaimers/accept is manager-only', () => {
    expect(canAccessRoute(manager, '/api/setu/disclaimers/accept', 'POST')).toBe(true);
    expect(canAccessRoute(member, '/api/setu/disclaimers/accept', 'POST')).toBe(false);
  });
  it('the /disclaimers page is any setu family', () => {
    expect(canAccessRoute(manager, '/disclaimers', 'GET')).toBe(true);
    expect(canAccessRoute(member, '/disclaimers', 'GET')).toBe(true);
    expect(canAccessRoute(welcome, '/disclaimers', 'GET')).toBe(false);
  });
  it('admin disclaimers editor + API are admin-only', () => {
    expect(canAccessRoute(admin, '/admin/disclaimers', 'GET')).toBe(true);
    expect(canAccessRoute(admin, '/api/admin/disclaimers', 'PUT')).toBe(true);
    expect(canAccessRoute(manager, '/admin/disclaimers', 'GET')).toBe(false);
    expect(canAccessRoute(welcome, '/api/admin/disclaimers', 'PUT')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/can-access-route-disclaimers.test.ts`
Expected: FAIL — POST accept currently falls to the manager+welcome+admin catch-all (welcome would pass) / member GET currently blocked by the manager-only catch-all.

- [ ] **Step 3: Add the canAccessRoute rules**

In `packages/shared-domain/src/auth/can-access-route.ts`, add BEFORE the final `/api/setu/` catch-all (`if (pathname.startsWith('/api/setu/')) { … }`):

```ts
  // Disclaimers: GET state = any setu family; POST accept = manager-only.
  if (pathname === '/api/setu/disclaimers' || pathname.startsWith('/api/setu/disclaimers/')) {
    if (!isSetuFamily(claims)) return false;
    if (method === 'POST') return isSetuManager(claims);
    return true;
  }
```

And add the page rule next to the `/complete-profile` page rule:

```ts
  // Disclaimers accept screen — a top-level route (NOT under /family, to avoid the
  // gate redirect loop) that the /family gate sends a not-yet-accepted manager to.
  if (pathname === '/disclaimers' || pathname.startsWith('/disclaimers/')) {
    return isSetuFamily(claims);
  }
```

- [ ] **Step 4: Add `/disclaimers` to the middleware deny-redirect Setu list**

In `apps/portal/src/middleware.ts`, inside `deny()`'s `isSetuRoute` expression, add the `/disclaimers` clause (so an unauthenticated hit redirects to `/sign-in`, not the legacy `/login`):

```ts
    pathname === '/complete-profile' || pathname.startsWith('/complete-profile/') ||
    pathname === '/disclaimers' || pathname.startsWith('/disclaimers/') ||
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/can-access-route-disclaimers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain/src/auth/can-access-route.ts apps/portal/src/middleware.ts packages/shared-domain/src/__tests__/can-access-route-disclaimers.test.ts
git commit -m "feat(disclaimers): route authorization (setu GET/accept, admin, page) + middleware redirect"
```

---

### Task 6: API routes

**Files:**
- Create: `apps/portal/src/app/api/setu/disclaimers/route.ts` (GET state)
- Create: `apps/portal/src/app/api/setu/disclaimers/accept/route.ts` (POST accept)
- Create: `apps/portal/src/app/api/admin/disclaimers/route.ts` (GET config + PUT publish)
- Test: `apps/portal/src/app/api/setu/disclaimers/__tests__/route.test.ts`
- Test: `apps/portal/src/app/api/admin/disclaimers/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `readSessionFromHeaders`; `getDisclaimersConfig`, `setDisclaimersConfig` (Task 3); `getDisclaimerStateForFamily`, `recordDisclaimerAcceptance` (Task 4); `getSchoolYearConfig`; `getFamilyByFid` (for the caller's stored acceptance); `isAdmin`, `isSetuManager` from `@cmt/shared-domain`.
- Produces: `GET /api/setu/disclaimers` → `{ version, schoolYear, sections, accepted }`. `POST /api/setu/disclaimers/accept` → `{ ok: true, version }`. `GET /api/admin/disclaimers` → `{ version, sections }`. `PUT /api/admin/disclaimers` → `{ version }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/portal/src/app/api/setu/disclaimers/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
const readSession = vi.fn();
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: (r: Request) => readSession(r) }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

const getFamilyByFid = vi.fn();
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid }));
const getState = vi.fn();
const record = vi.fn();
vi.mock('@/features/setu/disclaimers/acceptance', () => ({
  getDisclaimerStateForFamily: (...a: unknown[]) => getState(...a),
  recordDisclaimerAcceptance: (...a: unknown[]) => record(...a),
}));
const getConfig = vi.fn();
vi.mock('@/features/setu/disclaimers/config', () => ({ getDisclaimersConfig: (...a: unknown[]) => getConfig(...a) }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({ getSchoolYearConfig: async () => ({ currentYear: '2026-27' }) }));

import { GET } from '../route';
import { POST } from '../accept/route';

beforeEach(() => {
  readSession.mockReset(); getFamilyByFid.mockReset(); getState.mockReset(); record.mockReset(); getConfig.mockReset();
});

function req() { return new Request('http://x/api/setu/disclaimers'); }

describe('GET /api/setu/disclaimers', () => {
  it('401 with no session', async () => {
    readSession.mockReturnValue(null);
    expect((await GET(req())).status).toBe(401);
  });
  it('returns the family disclaimer state', async () => {
    readSession.mockReturnValue({ role: 'family-manager', fid: 'CMT-1', mid: 'm1' });
    getFamilyByFid.mockResolvedValue({ family: { disclaimersAccepted: null }, members: [] });
    getState.mockResolvedValue({ version: 3, schoolYear: '2026-27', sections: [], accepted: false });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 3, accepted: false });
  });
});

describe('POST /api/setu/disclaimers/accept', () => {
  it('records acceptance for the current version + year', async () => {
    readSession.mockReturnValue({ role: 'family-manager', fid: 'CMT-1', mid: 'm1' });
    getConfig.mockResolvedValue({ version: 3, sections: [] });
    const res = await POST(new Request('http://x/api/setu/disclaimers/accept', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 3 });
    expect(record).toHaveBeenCalledWith(expect.anything(), 'CMT-1', {
      version: 3, schoolYear: '2026-27', byMid: 'm1',
    });
  });
  it('401 without a fid', async () => {
    readSession.mockReturnValue({ role: 'family-manager', fid: null, mid: 'm1' });
    expect((await POST(new Request('http://x', { method: 'POST' }))).status).toBe(401);
  });
});
```

Create `apps/portal/src/app/api/admin/disclaimers/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const readSession = vi.fn();
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: (r: Request) => readSession(r) }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));
const getConfig = vi.fn();
const setConfig = vi.fn();
vi.mock('@/features/setu/disclaimers/config', () => ({
  getDisclaimersConfig: (...a: unknown[]) => getConfig(...a),
  setDisclaimersConfig: (...a: unknown[]) => setConfig(...a),
}));

import { GET, PUT } from '../route';

beforeEach(() => { readSession.mockReset(); getConfig.mockReset(); setConfig.mockReset(); });

const SECTION = { id: 'respect-responsibility', title: 'T', body: 'B' };

describe('GET /api/admin/disclaimers', () => {
  it('403 for a non-admin', async () => {
    readSession.mockReturnValue({ role: 'family-manager' });
    expect((await GET(new Request('http://x'))).status).toBe(403);
  });
  it('returns the editable config for an admin', async () => {
    readSession.mockReturnValue({ role: 'admin', uid: 'u' });
    getConfig.mockResolvedValue({ version: 4, sections: [SECTION] });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 4, sections: [SECTION] });
  });
});

describe('PUT /api/admin/disclaimers', () => {
  it('rejects empty title/body (400)', async () => {
    readSession.mockReturnValue({ role: 'admin', uid: 'u', mid: 'm-admin' });
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ sections: [{ id: 'a', title: '', body: 'b' }] }) }));
    expect(res.status).toBe(400);
  });
  it('publishes and returns the new version', async () => {
    readSession.mockReturnValue({ role: 'admin', uid: 'u', mid: 'm-admin' });
    setConfig.mockResolvedValue({ version: 5, sections: [SECTION] });
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ sections: [SECTION] }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 5 });
    expect(setConfig).toHaveBeenCalledWith(expect.anything(), [SECTION], 'm-admin');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/disclaimers src/app/api/admin/disclaimers`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write the setu GET route**

Create `apps/portal/src/app/api/setu/disclaimers/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';

/** GET /api/setu/disclaimers — the signed-in family's disclaimer state
 *  (current content + whether their acceptance is current). Mobile reads this. */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'no-family' }, { status: 401 });

  const fam = await getFamilyByFid(session.fid);
  if (!fam) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const state = await getDisclaimerStateForFamily(portalFirestore(), fam.family);
  return NextResponse.json(state, { status: 200 });
}
```

- [ ] **Step 4: Write the accept route**

Create `apps/portal/src/app/api/setu/disclaimers/accept/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { getDisclaimersConfig } from '@/features/setu/disclaimers/config';
import { recordDisclaimerAcceptance } from '@/features/setu/disclaimers/acceptance';

/** POST /api/setu/disclaimers/accept — record the family's acceptance of the
 *  CURRENT content version + school year (server-authoritative; any client-sent
 *  version is ignored). Manager-only (enforced by canAccessRoute). */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid || !session.mid) {
    return NextResponse.json({ error: 'no-family' }, { status: 401 });
  }

  const db = portalFirestore();
  const [config, schoolYearConfig] = await Promise.all([
    getDisclaimersConfig(db),
    getSchoolYearConfig(db),
  ]);

  await recordDisclaimerAcceptance(db, session.fid, {
    version: config.version,
    schoolYear: schoolYearConfig.currentYear,
    byMid: session.mid,
  });
  // Invalidate the family cache so the gate re-reads the fresh acceptance on the
  // subsequent HARD navigation to /family.
  revalidateTag(`family-${session.fid}`, 'max');

  return NextResponse.json({ ok: true, version: config.version }, { status: 200 });
}
```

- [ ] **Step 5: Write the admin route**

Create `apps/portal/src/app/api/admin/disclaimers/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getDisclaimersConfig, setDisclaimersConfig } from '@/features/setu/disclaimers/config';

// Write-time validation: non-empty id/title/body (the read schema deliberately
// does NOT enforce this). 1..8 sections is a sane bound for the editor.
const PutSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(8),
});

/** GET /api/admin/disclaimers — current editable content (admin only). */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const config = await getDisclaimersConfig(portalFirestore());
  return NextResponse.json({ version: config.version, sections: config.sections }, { status: 200 });
}

/** PUT /api/admin/disclaimers — publish edited content; bumps the version when
 *  content changed (⇒ all families re-accept on next visit). Admin only. */
export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // actorMid: prefer the admin's mid; fall back to uid so the audit field is set.
  const actor = session.mid ?? session.uid ?? 'admin';
  const config = await setDisclaimersConfig(portalFirestore(), parsed.data.sections, actor);
  return NextResponse.json({ version: config.version }, { status: 200 });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/disclaimers src/app/api/admin/disclaimers`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/api/setu/disclaimers apps/portal/src/app/api/admin/disclaimers
git commit -m "feat(disclaimers): setu GET/accept + admin GET/PUT API routes"
```

---

### Task 7: Client wrappers, accept form, and the /disclaimers page

**Files:**
- Create: `apps/portal/src/features/setu/disclaimers/disclaimers-client.ts`
- Create: `apps/portal/src/features/setu/disclaimers/components/disclaimer-accept-form.tsx`
- Create: `apps/portal/src/app/disclaimers/page.tsx`
- Create: `apps/portal/src/app/disclaimers/error.tsx`
- Test: `apps/portal/src/features/setu/disclaimers/__tests__/disclaimer-accept-form.test.tsx`

**Interfaces:**
- Consumes: `DisclaimerSection` (Task 1); `navigateTo` from `@/features/setu/members/navigate-to`; `CspRoot` from `@/features/family/components/atoms`; `SetuLogo`, `toast` from `@cmt/ui`; `getCurrentFamily` (page); `getDisclaimerStateForFamily` (page); `flags`.
- Produces: `acceptDisclaimersClient(): Promise<void>` (throws on non-OK); `<DisclaimerAcceptForm sections={DisclaimerSection[]} />`.

- [ ] **Step 1: Write the failing component test**

Create `apps/portal/src/features/setu/disclaimers/__tests__/disclaimer-accept-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigateTo = vi.fn();
vi.mock('@/features/setu/members/navigate-to', () => ({ navigateTo: (p: string) => navigateTo(p) }));
const accept = vi.fn();
vi.mock('../disclaimers-client', () => ({ acceptDisclaimersClient: () => accept() }));
vi.mock('@cmt/ui', () => ({
  SetuLogo: () => null,
  toast: { error: vi.fn() },
}));
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { DisclaimerAcceptForm } from '../components/disclaimer-accept-form';

const SECTIONS = [
  { id: 'a', title: 'Alpha', body: 'A body' },
  { id: 'b', title: 'Beta', body: 'B body' },
];

beforeEach(() => { navigateTo.mockReset(); accept.mockReset(); accept.mockResolvedValue(undefined); });

describe('DisclaimerAcceptForm', () => {
  it('renders every section title + body', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('B body')).toBeInTheDocument();
  });

  it('keeps the continue button disabled until every box is checked', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} />);
    const btn = screen.getByTestId('disclaimers-accept');
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId('disclaimer-check-a'));
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId('disclaimer-check-b'));
    expect(btn).toBeEnabled();
  });

  it('accepts then hard-navigates to /family', async () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} />);
    fireEvent.click(screen.getByTestId('disclaimer-check-a'));
    fireEvent.click(screen.getByTestId('disclaimer-check-b'));
    fireEvent.click(screen.getByTestId('disclaimers-accept'));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/disclaimers/__tests__/disclaimer-accept-form.test.tsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the client wrapper**

Create `apps/portal/src/features/setu/disclaimers/disclaimers-client.ts`:

```ts
// Client-safe wrappers around the disclaimers routes. Call THESE from UI
// components and mock THESE in component tests (the routes use next/headers +
// firebase-admin, server-only). Both THROW on a non-OK response so the UI can
// surface an error toast (matches searchFamiliesClient).
import type { DisclaimerSection } from '@cmt/shared-domain/setu';

export async function acceptDisclaimersClient(): Promise<void> {
  const res = await fetch('/api/setu/disclaimers/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`accept-failed:${res.status}`);
}

export async function saveDisclaimersClient(sections: DisclaimerSection[]): Promise<number> {
  const res = await fetch('/api/admin/disclaimers', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ sections }),
  });
  if (!res.ok) throw new Error(`save-failed:${res.status}`);
  const body = (await res.json()) as { version: number };
  return body.version;
}
```

- [ ] **Step 4: Write the accept form**

Create `apps/portal/src/features/setu/disclaimers/components/disclaimer-accept-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { SetuLogo, toast } from '@cmt/ui';
import type { DisclaimerSection } from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { navigateTo } from '@/features/setu/members/navigate-to';
import { acceptDisclaimersClient } from '../disclaimers-client';

/**
 * Accept-all disclaimer screen. One required checkbox per section; the continue
 * button enables only when every box is checked. On submit it records acceptance
 * and leaves via a HARD navigation to /family (never router.push) so the /family
 * gate re-runs server-side on fresh data.
 */
export function DisclaimerAcceptForm({ sections }: { sections: DisclaimerSection[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const allChecked = sections.length > 0 && sections.every((s) => checked[s.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allChecked || saving) return;
    setSaving(true);
    try {
      await acceptDisclaimersClient();
    } catch {
      toast.error('Something went wrong saving your acknowledgement. Please try again.');
      setSaving(false);
      return;
    }
    // Leave via a hard navigation; keep saving=true (the page is unloading).
    navigateTo('/family');
  }

  const body = (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px 40px' }}>
      <div style={{ marginBottom: 26 }}><SetuLogo size={22} /></div>
      <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Before you continue
      </p>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>
        Our family agreement
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5, marginBottom: 22 }}>
        Please read and acknowledge each section to continue to your family dashboard.
      </p>

      {sections.map((s) => (
        <div key={s.id} className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accentDeep)', marginBottom: 6 }}>{s.title}</div>
          <p style={{ fontSize: 13.5, color: 'var(--body-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{s.body}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5 }}>
            <input
              type="checkbox"
              data-testid={`disclaimer-check-${s.id}`}
              checked={!!checked[s.id]}
              onChange={(e) => setChecked((prev) => ({ ...prev, [s.id]: e.target.checked }))}
              style={{ width: 18, height: 18 }}
            />
            I have read and agree to the above.
          </label>
        </div>
      ))}

      <button
        type="submit"
        className="btn btn--p btn--block"
        data-testid="disclaimers-accept"
        disabled={!allChecked || saving}
        style={{ marginTop: 8 }}
      >
        {saving ? 'Saving…' : 'Agree & continue'}
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <CspRoot style={{ minHeight: '100dvh' }}>{body}</CspRoot>
    </form>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/disclaimers/__tests__/disclaimer-accept-form.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the page + error boundary**

Create `apps/portal/src/app/disclaimers/page.tsx`:

```tsx
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
import { DisclaimerAcceptForm } from '@/features/setu/disclaimers/components/disclaimer-accept-form';

export const metadata = { title: 'Family agreement' };

// Top-level route, OUTSIDE the /family layout (mirrors /complete-profile) so the
// /family DisclaimerGate never re-runs here — nothing to loop.
export default async function DisclaimersPage() {
  await connection();
  if (!flags.setuDisclaimers) redirect('/family');

  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in');
  // Per-family: only the manager accepts. A non-manager who lands here directly
  // is not required — send them on.
  if (!data.isManager) redirect('/family');

  const state = await getDisclaimerStateForFamily(portalFirestore(), data.family);
  if (state.accepted) redirect('/family');

  return <DisclaimerAcceptForm sections={state.sections} />;
}
```

Create `apps/portal/src/app/disclaimers/error.tsx`:

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function DisclaimersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Family agreement" />;
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @cmt/portal typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/features/setu/disclaimers/disclaimers-client.ts apps/portal/src/features/setu/disclaimers/components apps/portal/src/app/disclaimers
git commit -m "feat(disclaimers): accept form + /disclaimers page + client wrappers"
```

---

### Task 8: Admin editor page + dashboard tile

**Files:**
- Create: `apps/portal/src/features/admin/disclaimers/disclaimers-editor.tsx`
- Create: `apps/portal/src/app/admin/disclaimers/page.tsx`
- Create: `apps/portal/src/app/admin/disclaimers/error.tsx`
- Modify: `apps/portal/src/app/admin/page.tsx` (add a "Disclaimers" tile to the "People & access" group)
- Test: `apps/portal/src/features/admin/disclaimers/__tests__/disclaimers-editor.test.tsx`

**Interfaces:**
- Consumes: `DisclaimerSection` (Task 1); `saveDisclaimersClient` (Task 7); `toast` from `@cmt/ui`; `getDisclaimersConfig` (page).
- Produces: `<DisclaimersEditor initialSections={DisclaimerSection[]} initialVersion={number} />`.

- [ ] **Step 1: Write the failing component test**

Create `apps/portal/src/features/admin/disclaimers/__tests__/disclaimers-editor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const save = vi.fn();
vi.mock('@/features/setu/disclaimers/disclaimers-client', () => ({
  saveDisclaimersClient: (...a: unknown[]) => save(...a),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@cmt/ui', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DisclaimersEditor } from '../disclaimers-editor';

const SECTIONS = [{ id: 'respect-responsibility', title: 'Respect', body: 'Be kind.' }];

beforeEach(() => { save.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

describe('DisclaimersEditor', () => {
  it('renders each section title + body in editable inputs', () => {
    render(<DisclaimersEditor initialSections={SECTIONS} initialVersion={2} />);
    expect(screen.getByDisplayValue('Respect')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Be kind.')).toBeInTheDocument();
  });

  it('publishes edited content and reports the new version', async () => {
    save.mockResolvedValue(3);
    render(<DisclaimersEditor initialSections={SECTIONS} initialVersion={2} />);
    fireEvent.change(screen.getByDisplayValue('Be kind.'), { target: { value: 'Be very kind.' } });
    fireEvent.click(screen.getByTestId('disclaimers-publish'));
    // Confirm dialog gate: confirm before the network call.
    fireEvent.click(screen.getByTestId('disclaimers-publish-confirm'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0][0]).toMatchObject({ id: 'respect-responsibility', body: 'Be very kind.' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/disclaimers/__tests__/disclaimers-editor.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the editor**

Create `apps/portal/src/features/admin/disclaimers/disclaimers-editor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { DisclaimerSection } from '@cmt/shared-domain/setu';
import { saveDisclaimersClient } from '@/features/setu/disclaimers/disclaimers-client';

/** Admin editor for the disclaimer sections. Publishing bumps the content
 *  version (when changed) → all families re-accept on their next visit, so
 *  publish is behind an inline confirm. */
export function DisclaimersEditor({
  initialSections,
  initialVersion,
}: {
  initialSections: DisclaimerSection[];
  initialVersion: number;
}) {
  const [sections, setSections] = useState<DisclaimerSection[]>(initialSections);
  const [version, setVersion] = useState(initialVersion);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  function update(i: number, patch: Partial<DisclaimerSection>) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function publish() {
    setConfirming(false);
    setSaving(true);
    try {
      const next = await saveDisclaimersClient(sections);
      setVersion(next);
      toast.success(`Published — version ${next}. Families will re-accept on their next visit.`);
    } catch {
      toast.error('Could not publish. Please check the fields and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Current published version: <strong>{version}</strong>
      </p>

      {sections.map((s, i) => (
        <div key={s.id} className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Section title</label>
            <input
              className="input"
              value={s.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Section text</label>
            <textarea
              className="input"
              rows={4}
              value={s.body}
              onChange={(e) => update(i, { body: e.target.value })}
            />
          </div>
        </div>
      ))}

      {confirming ? (
        <div className="card" style={{ padding: 16, marginTop: 8, borderColor: 'var(--accent)' }}>
          <p style={{ fontSize: 13.5, marginBottom: 12 }}>
            Publishing will ask <strong>all families</strong> to re-accept on their next visit. Continue?
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--p" data-testid="disclaimers-publish-confirm" onClick={publish} disabled={saving}>
              {saving ? 'Publishing…' : 'Yes, publish'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--p" data-testid="disclaimers-publish" onClick={() => setConfirming(true)} disabled={saving}>
          Publish
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the admin page + error boundary**

Create `apps/portal/src/app/admin/disclaimers/page.tsx`:

```tsx
import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getDisclaimersConfig } from '@/features/setu/disclaimers/config';
import { DisclaimersEditor } from '@/features/admin/disclaimers/disclaimers-editor';

export const metadata = { title: 'Disclaimers' };

export default async function AdminDisclaimersPage() {
  await connection();
  const config = await getDisclaimersConfig(portalFirestore());

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Admin</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Disclaimers</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          The family agreement sections shown when a family signs in. Edit the text below and publish.
          Publishing asks every family to re-accept on their next visit; a new school year also re-prompts.
        </p>
      </header>

      <div style={{ maxWidth: 640 }}>
        <DisclaimersEditor initialSections={config.sections} initialVersion={config.version} />
      </div>
    </>
  );
}
```

Create `apps/portal/src/app/admin/disclaimers/error.tsx`:

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function AdminDisclaimersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Disclaimers admin" />;
}
```

- [ ] **Step 5: Add the admin dashboard tile**

In `apps/portal/src/app/admin/page.tsx`, add this tile to the `'People & access'` group's `tiles` array (after the "Users & roles" tile):

```ts
      { href: '/admin/disclaimers', title: 'Disclaimers', icon: 'info', tone: 'primary', sub: 'Edit the family agreement sections families accept at sign-in. Publishing asks all families to re-accept.' },
```

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/admin/disclaimers/__tests__/disclaimers-editor.test.tsx`
Expected: PASS (2 tests).
Run: `pnpm --filter @cmt/portal typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/admin/disclaimers apps/portal/src/app/admin/disclaimers apps/portal/src/app/admin/page.tsx
git commit -m "feat(disclaimers): admin editor page + dashboard tile"
```

---

### Task 9: The DisclaimerGate in the /family layout

**Files:**
- Modify: `apps/portal/src/app/family/layout.tsx` (add `DisclaimerGate` + render it after `ProfileCompletionGate`)
- Test: `apps/portal/src/app/family/__tests__/disclaimer-gate.test.tsx`

**Interfaces:**
- Consumes: `flags.setuDisclaimers`; `getCurrentFamily`; `incompleteMembers` from `@cmt/shared-domain`; `getDisclaimerStateForFamily` (Task 4); `portalFirestore`; `redirect`.
- Produces: `export async function DisclaimerGate(): Promise<null>` — redirects a not-yet-accepted manager to `/disclaimers`.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/app/family/__tests__/disclaimer-gate.test.tsx` (mirrors the profile-completion-gate test):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
);
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

const flagsMock = vi.hoisted(() => ({ setuAuth: true, setuDisclaimers: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mockGetCurrentFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: mockGetCurrentFamily }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

const mockGetState = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/disclaimers/acceptance', () => ({ getDisclaimerStateForFamily: mockGetState }));

import { DisclaimerGate } from '../layout';

function adult(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-adult', uid: 'u1', firstName: 'Asha', lastName: 'Rao', type: 'Adult', gender: 'Female',
    manager: true, joinedAt: new Date(), email: 'a@x.com', phone: '+14165551234', altEmails: [], altPhones: [],
    schoolGrade: null, birthMonthYear: null, volunteeringSkills: ['Kitchen'], foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Spouse', phone: '+14165550000', email: 'x@x.com' }, null], ...over,
  } as MemberDoc;
}
function child(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-child', uid: null, firstName: 'Dev', lastName: 'Rao', type: 'Child', gender: 'Male',
    manager: false, joinedAt: new Date(), email: null, phone: null, altEmails: [], altPhones: [],
    schoolGrade: 'Grade 3', birthMonthYear: '2017-03', birthMonth: 3, volunteeringSkills: [], foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Mother', phone: '+14165550000', email: 'x@x.com' }, null], ...over,
  } as MemberDoc;
}
function family(members: MemberDoc[], over: Partial<FamilyWithMembers> = {}): FamilyWithMembers {
  return { family: { fid: 'CMT-1', name: 'Rao', disclaimersAccepted: null } as FamilyWithMembers['family'],
    members, currentMid: members[0]?.mid ?? 'm-adult', isManager: true, ...over };
}

beforeEach(() => {
  mockRedirect.mockClear(); mockGetCurrentFamily.mockReset(); mockGetState.mockReset();
  flagsMock.setuAuth = true; flagsMock.setuDisclaimers = true;
});

describe('DisclaimerGate', () => {
  it('redirects a manager who has not accepted the current version', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()]));
    mockGetState.mockResolvedValue({ accepted: false, version: 3, schoolYear: '2026-27', sections: [] });
    await expect(DisclaimerGate()).rejects.toThrow('NEXT_REDIRECT:/disclaimers');
    expect(mockRedirect).toHaveBeenCalledWith('/disclaimers');
  });

  it('does nothing when the manager has accepted', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()]));
    mockGetState.mockResolvedValue({ accepted: true, version: 3, schoolYear: '2026-27', sections: [] });
    expect(await DisclaimerGate()).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does NOT gate a plain family-member (per-family: manager accepts)', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()], { isManager: false }));
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetState).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('defers to the profile gate when the family profile is incomplete', async () => {
    // Child missing schoolGrade ⇒ incomplete; the disclaimer gate no-ops so the
    // profile gate (rendered first) sends the user to /complete-profile first.
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child({ schoolGrade: null })]));
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetState).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does nothing when the flag is off', async () => {
    flagsMock.setuDisclaimers = false;
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetCurrentFamily).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session', async () => {
    mockGetCurrentFamily.mockResolvedValue(null);
    expect(await DisclaimerGate()).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/family/__tests__/disclaimer-gate.test.tsx`
Expected: FAIL — `DisclaimerGate` is not exported.

- [ ] **Step 3: Add the gate to the layout**

In `apps/portal/src/app/family/layout.tsx`:

Add to the `@cmt/shared-domain` import (it already imports `incompleteMembers`), and add these imports near the top:

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
```

Add the gate component right after `ProfileCompletionGate`:

```tsx
// Disclaimer-acceptance gate (Slice 2). Runs on every /family/* render AFTER the
// profile gate. Per-family: only the MANAGER accepts. Redirects to the top-level
// /disclaimers screen (OUTSIDE this layout, like /complete-profile) when the
// family's acceptance isn't current (stale version or new school year). Flag-gated
// OFF by default. Guards on profile-completeness so the profile gate always runs
// first regardless of Suspense resolution order.
export async function DisclaimerGate() {
  if (!flags.setuDisclaimers) return null;

  const data = await getCurrentFamily();
  if (!data) return null; // unauthenticated — middleware handles it
  if (!data.isManager) return null; // per-family: members aren't gated
  // Defer to ProfileCompletionGate if the profile is still incomplete.
  if (incompleteMembers(data.members).length > 0) return null;

  const state = await getDisclaimerStateForFamily(portalFirestore(), data.family);
  if (!state.accepted) redirect('/disclaimers');
  return null;
}
```

Render it after `<ProfileCompletionGate />` inside `FamilyLayout`, in its own Suspense boundary:

```tsx
      <Suspense fallback={null}>
        <ProfileCompletionGate />
      </Suspense>
      <Suspense fallback={null}>
        <DisclaimerGate />
      </Suspense>
```

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/family/__tests__/disclaimer-gate.test.tsx`
Expected: PASS (6 tests).
Run: `pnpm --filter @cmt/portal typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/family/layout.tsx apps/portal/src/app/family/__tests__/disclaimer-gate.test.tsx
git commit -m "feat(disclaimers): DisclaimerGate in the /family layout (manager, post-profile)"
```

---

### Task 10: Dashboard API parity (disclaimersPending) + MOBILE_API_CHANGELOG

**Files:**
- Modify: `apps/portal/src/app/api/setu/dashboard/route.ts` (add `disclaimersPending`)
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md` (new entry)
- Test: `apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts` (extend or add a case)

**Interfaces:**
- Consumes: `flags.setuDisclaimers`; `getDisclaimerStateForFamily` (Task 4); `portalFirestore`; the existing `getSessionFamily(req)`.
- Produces: additive top-level `disclaimersPending: boolean` on the dashboard payload — `flags.setuDisclaimers && isManager && !accepted`; computed fail-soft (any error ⇒ `false`). Computed in the ROUTE (which already has `fam.isManager` + `fam.family`), NOT in `loadFamilyDashboard` (kept untouched — it's the verified Slice 1 loader).

- [ ] **Step 1: Write the failing test**

In `apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts`, add a test asserting `disclaimersPending` is present. If the file mocks `loadFamilyDashboard`, also mock the disclaimers acceptance module. Add:

```ts
// (add to the existing mocks)
vi.mock('@/features/setu/disclaimers/acceptance', () => ({
  getDisclaimerStateForFamily: vi.fn(async () => ({ accepted: false, version: 1, schoolYear: '2026-27', sections: [] })),
}));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true, setuDisclaimers: true } }));

it('includes disclaimersPending (true for an unaccepted manager)', async () => {
  // ...arrange a manager session + family the same way the file's other tests do...
  const res = await GET(/* the file's request fixture */);
  const body = await res.json();
  expect(body).toHaveProperty('disclaimersPending', true);
});
```

Follow the file's existing session/family mock setup for the arrange step (it already stubs `getSessionFamily` + `loadFamilyDashboard`); the new assertion only needs `disclaimersPending` on the response.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/dashboard/__tests__/route.test.ts`
Expected: FAIL — `disclaimersPending` is missing from the payload.

- [ ] **Step 3: Add the field to the route**

In `apps/portal/src/app/api/setu/dashboard/route.ts`, add the imports:

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
```

After the `loadFamilyDashboard` call, compute the flag fail-soft:

```ts
  // Slice 2: mobile gate signal. Only meaningful for a manager (per-family
  // acceptance). Fail-soft — a config hiccup must never 500 the mobile home.
  let disclaimersPending = false;
  if (flags.setuDisclaimers && fam.isManager) {
    try {
      const st = await getDisclaimerStateForFamily(portalFirestore(), fam.family);
      disclaimersPending = !st.accepted;
    } catch {
      disclaimersPending = false;
    }
  }
```

Add `disclaimersPending` to the returned JSON object (next to `actionItems`):

```ts
      actionItems: model.actionItems,
      // Slice 2: true when this (manager) family must accept the current
      // disclaimers before using the portal. Web enforces this via a redirect
      // gate; mobile decides its own gating. Always false when the flag is off,
      // for a family-member, or on a read error.
      disclaimersPending,
```

- [ ] **Step 4: Add the MOBILE_API_CHANGELOG entry**

Append a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md` (use `<SHA>` and backfill the real commit hash after committing — the final review checks for this):

```markdown
## `<SHA>` · 2026-07-03 — Disclaimers (Slice 2)

**New — `GET /api/setu/disclaimers`** → `{ version:number, schoolYear:string, sections:{id,title,body}[], accepted:boolean }`. The signed-in family's disclaimer state. Any family role.

**New — `POST /api/setu/disclaimers/accept`** (no body) → `{ ok:true, version:number }`. Records acceptance of the CURRENT version + school year. **Manager-only** (a family-member gets 401/`unauthorized`). Server-authoritative version.

**Changed — `GET /api/setu/dashboard`** gains additive top-level **`disclaimersPending: boolean`** — true when this (manager) family must accept before using the portal; false for a family-member, when the feature flag is off, or on a read error.

**Mobile action:** on launch, a manager session should check `disclaimersPending` (or `GET /api/setu/disclaimers`); if pending, show the accept screen (render `sections`, one required checkbox each) and `POST …/accept` before proceeding. Acceptance is per-family (manager); a stale version or new `schoolYear` re-prompts. Flag `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS` gates the web gate — until it's on in an environment, `disclaimersPending` is always false there.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/dashboard/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/api/setu/dashboard/route.ts apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(disclaimers): additive dashboard disclaimersPending + mobile changelog"
```

---

### Task 11: E2E seed control + deployed-UAT E2E (WRITE ONLY — run at the owner gate)

**Files:**
- Modify: `apps/portal/scripts/seed-e2e-family.ts` (add `--disclaimers <accepted|pending>`, default `accepted`)
- Create: `apps/portal/e2e/setu/disclaimers.spec.ts`

**Interfaces:**
- Consumes: `getDisclaimersConfig`, `getSchoolYearConfig`; the shared E2E family (manager `E2E Tester`, who is ALSO granted admin, so the single account drives both the accept flow and the admin editor); `signInFamilyAndSaveStorage` from `e2e/auth-helpers.ts`.

> **Cross-spec safety (critical):** the shared E2E family manager is used by EVERY setu spec. If `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true` in UAT and this family has no acceptance, EVERY spec's `/family` navigation would bounce to `/disclaimers` and fail. Therefore the seed's DEFAULT ground state MUST be **accepted** (`--disclaimers accepted`): the seed writes an acceptance for the CURRENT `(schoolYear, version)`. The disclaimers spec temporarily flips the fixture to pending and restores it in `afterAll`.

- [ ] **Step 1: Add the seed control**

In `apps/portal/scripts/seed-e2e-family.ts`:

Parse the arg (near the other argv parsing in `main()`):

```ts
  // --disclaimers <accepted|pending> (default 'accepted'). 'accepted' writes an
  // acceptance for the CURRENT (schoolYear, version) so the shared fixture is
  // NOT gated in other specs once the flag is on; 'pending' clears it so the
  // disclaimers spec can exercise the gate. Absence/invalid → 'accepted'.
  const disclaimersArg = (() => {
    const i = process.argv.indexOf('--disclaimers');
    const raw = i !== -1 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith('--disclaimers='))?.slice('--disclaimers='.length);
    return raw === 'pending' ? 'pending' : 'accepted';
  })();
```

Add these two imports at the top of the file:

```ts
import { getDisclaimersConfig } from '@/features/setu/disclaimers/config';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
```

The file ALREADY imports `{ portalFirestore, FieldValue }` from `@cmt/firebase-shared/admin/firestore` — reuse that `FieldValue` (including `FieldValue.delete()` and `FieldValue.serverTimestamp()`); do NOT add a second import of it.

Near the end of `main()` (after the enrollment/donation section, before the final `done` log), write/clear the acceptance:

```ts
  // Disclaimers (Slice 2) ground state on the shared fixture.
  if (disclaimersArg === 'pending') {
    await db.collection('families').doc(fid).set(
      { disclaimersAccepted: FieldValue.delete() },
      { merge: true },
    );
    console.log('disclaimers: cleared acceptance (pending ground state)');
  } else {
    const [cfg, sy] = await Promise.all([getDisclaimersConfig(db), getSchoolYearConfig(db)]);
    await db.collection('families').doc(fid).set(
      {
        disclaimersAccepted: {
          schoolYear: sy.currentYear,
          version: cfg.version,
          acceptedByMid: managerMid,
          acceptedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    console.log(`disclaimers: accepted (schoolYear=${sy.currentYear}, version=${cfg.version})`);
  }
```

Update the header docblock's `Run:` line to mention `[--disclaimers <accepted|pending>]`.

- [ ] **Step 2: Write the E2E spec**

Create `apps/portal/e2e/setu/disclaimers.spec.ts`. It runs against DEPLOYED UAT (the `setu` Playwright project). Requires `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true` in the UAT Vercel env (see the run note in Step 3). The single E2E account is both manager and admin.

```ts
import { test, expect, request as pwRequest } from '@playwright/test';
import { E2E_BASE_URL } from '../_helpers';
import { signInFamilyAndSaveStorage } from '../auth-helpers';

// Serial: shared fixture. The whole file drives the ONE E2E family manager
// (also admin). We flip the fixture to "pending" up front and restore
// "accepted" at the end so no sibling spec is left gated.
test.describe.configure({ mode: 'serial' });

async function reseed(disclaimers: 'accepted' | 'pending') {
  // Reseeds via the deployed app is not possible; the seed runs locally against
  // UAT. In CI/local the runner invokes the seed before the suite. Here we drive
  // acceptance state through the REAL APIs instead of the script, so the spec is
  // self-contained: to make it "pending" we publish a new admin version (which
  // makes any prior acceptance stale); to restore "accepted" we accept again.
  void disclaimers;
}

test.beforeAll(async () => {
  // Fresh session (the shared storageState may be stale from a sibling reseed).
  const ctx = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  await signInFamilyAndSaveStorage(ctx);
  await ctx.dispose();
});

test('manager is gated to /disclaimers, accepts, and reaches the dashboard', async ({ page, request }) => {
  // 1) Make the fixture "pending" by publishing a new admin version (bumps the
  //    content version → the fixture's prior acceptance is now stale).
  const editRes = await request.get('/api/admin/disclaimers');
  expect(editRes.ok()).toBeTruthy();
  const { sections } = await editRes.json();
  const bumped = sections.map((s: { id: string; title: string; body: string }, i: number) =>
    i === 0 ? { ...s, body: `${s.body} (rev ${Date.now()})` } : s,
  );
  const pubRes = await request.put('/api/admin/disclaimers', { data: { sections: bumped } });
  expect(pubRes.ok()).toBeTruthy();

  // 2) Visiting /family now bounces to /disclaimers (hard nav re-runs the gate).
  await page.goto('/family');
  await expect(page).toHaveURL(/\/disclaimers$/);

  // 3) The accept screen shows the sections; the button is disabled until all
  //    boxes are checked.
  const acceptBtn = page.getByTestId('disclaimers-accept');
  await expect(acceptBtn).toBeDisabled();
  for (const s of bumped) {
    await page.getByTestId(`disclaimer-check-${s.id}`).click();
  }
  await expect(acceptBtn).toBeEnabled();

  // 4) Accept → hard nav to /family, and no more gate on re-visit.
  await acceptBtn.click();
  await expect(page).toHaveURL(/\/family$/);
  await page.goto('/family');
  await expect(page).toHaveURL(/\/family$/);
});

test.afterAll(async () => {
  // Restore an accepted ground state so sibling specs aren't gated: sign in and
  // POST accept for the CURRENT version (the earlier test already accepted, but
  // this is a belt-and-braces restore in case that test failed mid-way).
  const ctx = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  await signInFamilyAndSaveStorage(ctx);
  await ctx.post('/api/setu/disclaimers/accept');
  await ctx.dispose();
});
```

> Adapt `E2E_BASE_URL` / `E2E_FAMILY_*` imports to the actual exports in `e2e/_helpers.ts` (the Slice 1 specs import `E2E_FAMILY_EMAIL`/`E2E_FAMILY_PASSWORD` from there; use the same base-URL constant those specs use). Do NOT run OTP; use the password-sign-in helper. `reseed()` is a documentation stub — the spec drives state through the real APIs, so it never shells out to the seed mid-run.

- [ ] **Step 3: Typecheck only — DO NOT run the E2E (owner gate)**

Run: `pnpm --filter @cmt/portal typecheck`
Expected: no errors.

The E2E is written but NOT run in this task. It runs at the owner gate, AFTER the batch push + Vercel deploy, and ONLY once `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true` is set in the UAT Vercel env and the shared fixture is seeded `--disclaimers accepted`. Command (owner-run):
`PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal test:e2e -- disclaimers`
(If the sign-in limiter trips: `pnpm --filter @cmt/portal clear:otp-rate-limit <E2E_FAMILY_EMAIL>`.)

- [ ] **Step 4: Commit**

```bash
git add apps/portal/scripts/seed-e2e-family.ts apps/portal/e2e/setu/disclaimers.spec.ts
git commit -m "test(disclaimers): seed --disclaimers control + deployed-UAT E2E (write only)"
```

---

### Task 12: Runbook §14 entry

**Files:**
- Modify: `docs/runbooks/production-cutover-checklist.md` (append a dated §14 entry)

- [ ] **Step 1: Append the §14 entry**

Add a dated entry to §14 of `docs/runbooks/production-cutover-checklist.md` capturing Slice 2:

```markdown
### 2026-07-03 — Slice 2: Family disclaimers

- **New flag `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS`** (OFF by default). Gates the
  /family DisclaimerGate, the /disclaimers route, and the dashboard
  `disclaimersPending` field. Ships dark; flip ON in UAT for the E2E gate and at
  launch. Registered in `turbo.json` `env`.
- **New `app_config/disclaimers` doc** (admin-editable at /admin/disclaimers).
  Created on the first admin publish; absent = seed DEFAULT (version 1). No seed
  write required to ship.
- **New optional `families.disclaimersAccepted` field** `{ schoolYear, version,
  acceptedByMid, acceptedAt }`. Absence = must-accept; NO backfill/migration.
- **No new Firestore composite index** (all single-doc reads).
- **canAccessRoute**: `/api/setu/disclaimers` GET any-family / POST accept
  manager-only; `/disclaimers` page any-family; admin editor + API admin-only.
- **Mobile**: additive `GET /api/setu/disclaimers`, `POST …/accept`, and
  `dashboard.disclaimersPending`. MOBILE_API_CHANGELOG updated.
- **E2E**: `e2e/setu/disclaimers.spec.ts` (deployed UAT). The shared E2E family
  seed default is `--disclaimers accepted` so the fixture is NOT gated in other
  specs once the flag is on.
- **Prod cutover**: setting `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true` in prod
  gates ALL families on their next manager visit (absence = must-accept). Confirm
  the seed content / admin copy is finalized before flipping.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/production-cutover-checklist.md
git commit -m "docs(disclaimers): runbook §14 entry for Slice 2"
```

---

## Post-task close-out (controller, after Task 12)

1. **Full local gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green.
2. **Final whole-branch review** (Opus, most-capable) over the whole range; dispatch ONE fix subagent for any Critical/Important findings.
3. **Batch push** to `main` (single push; the pre-push hook re-runs the gate). Backfill the `<SHA>` in MOBILE_API_CHANGELOG.md to the Task 10 commit (or merge SHA).
4. **Owner UAT E2E gate (PAUSE before this):** set `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true` in the UAT Vercel env, seed `pnpm --filter @cmt/portal seed:e2e-family` (writes `--disclaimers accepted`), then run the disclaimers E2E against `https://cmt-setu.vercel.app`. Confirm the sibling Slice 1 specs (`dashboard-slice1`, `enrollment-state`) still pass with the flag ON (they should — the fixture is seeded accepted).

## Self-review notes

- **Spec coverage:** content doc (T3) · acceptance record + predicate (T1/T4) · gate (T9) · /disclaimers accept screen (T7) · admin editor (T8) · APIs + authz (T5/T6) · mobile parity + changelog (T10) · flag (T2) · E2E + seed (T11) · runbook (T12). All spec sections map to a task.
- **Type consistency:** `DisclaimerSection`/`DisclaimersConfig`/`DisclaimerAcceptance` defined in T1 and consumed unchanged in T3–T11; `getDisclaimerStateForFamily` signature is stable across T4 (def), T6/T9/T10 (use); `isDisclaimerAccepted(accepted, config, currentYear)` stable across T1 (def) and T4 (use). School-year label format is `YYYY-YY` (`2026-27`) everywhere.
- **No placeholders:** every code step has complete code; the only `<SHA>` is the changelog key, explicitly backfilled in close-out (matches the Slice 1 process).
