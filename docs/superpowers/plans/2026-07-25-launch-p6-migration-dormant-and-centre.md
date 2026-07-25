# P6 - Dormant-Family Skip & Unknown-Centre Prompt - Implementation Plan

> # ⛔ SUPERSEDED 2026-07-25 - DO NOT IMPLEMENT THIS FILE
>
> Replaced by **`2026-07-25-launch-p6-migration-dormant-and-centre-v2.md`**.
> Reviewed as REQUEST CHANGES: 2 critical, 7 major, 7 minor
> (`docs/superpowers/reviews/2026-07-25-review-p6.md`). The dormancy predicate is sound
> and its numbers reproduce against the real snapshot; both criticals are on the
> centre-prompt half.
>
> 1. **The flag never reaches the gate - it ships as dead code with passing tests.**
>    `FamilyDoc` values are built by a **hand-written field map** in
>    `get-family-by-fid.ts:27-45` with no spread, so a field added only to the Zod schema
>    is `undefined` forever. The plan's tests mock `getCurrentFamily`, so all four pass
>    green against a feature that is inert in UAT and prod.
> 2. **A family whose only gap is the centre hits an infinite redirect loop.**
>    `complete-profile-form.tsx:223-231` hard-navigates back to `/family` when members and
>    address are complete, with no notion of the centre - and because it is a *hard* nav
>    the gate re-runs on fresh data every time, so the loop is permanent.
>
> Also: `PATCH /api/setu/family` does not accept `location` at all (the plan asserted it
> did), and the migration wiring is unimplementable because the script never sees a
> `LegacyRosterRow`. Work from v2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stop the bulk migration from importing ~190 stale-grade children of dormant families, and ask any family whose legacy centre was unknown to confirm it at first sign-in instead of silently defaulting them to Brampton.

**Architecture:** the migration gains a dormant filter driven by the legacy roster data itself. Because `FamilyDocSchema.location` is a read-validated `z.string().min(1)` that many consumers assume is present, the unknown-ness is carried by a new **additive** `locationNeedsConfirmation` flag rather than by nulling the location. The parser reports when it fell back to the default, lazy migration persists that, and the existing profile-completion gate routes the family to a centre selector.

**Tech Stack:** TypeScript, Zod, Firebase Admin Firestore, Vitest, Playwright.

**Depends on:** nothing. Runs independently of P1-P5.

> **Why this plan exists:** it covers launch-batch spec **§1.9b** and **§1.9c**, which a coverage review found were implemented by none of P1-P5. Both are cutover-blocking - §1.9b changes what the prod migration imports, and §1.9c is the only thing standing between an unknown-centre family and a silent Brampton assignment.

## Global Constraints

See `2026-07-25-aug-3-launch-INDEX.md` § Global Constraints. Specific to this plan:

- **Never widen a doc schema's required-ness**, and never null `location`. `FamilyDocSchema.location` is `z.string().min(1)` validated on **read** (`schemas/family.ts:55`); writing null or `''` would fail validation on every subsequent read of that family. The new flag is `nullable().optional()`, which widens rather than tightens.
- Local scripts read the **RTDB snapshot**, never live RTDB. `RTDB_SNAPSHOT_DIR=.rtdb-snapshot` must stay set.
- Any UAT DB operation requires a runbook update in the same change.

---

## File Structure

- `apps/portal/src/features/setu/registration/legacy-parser.ts` - report when `mapLocation` defaulted; add a dormancy predicate
- `apps/portal/src/features/setu/registration/lazy-migrate.ts:197` - persist the flag
- `packages/shared-domain/src/setu/schemas/family.ts` - add `locationNeedsConfirmation`
- `apps/portal/scripts/migrate-legacy-families.ts` - skip dormant families, report the skipped set
- `apps/portal/src/app/family/layout.tsx` - extend the profile gate
- `apps/portal/src/features/setu/members/complete-profile-form.tsx` - centre selector
- `apps/portal/src/app/api/setu/family/route.ts` - accept the centre and clear the flag

---

### Task 1: Report when the centre was defaulted

`mapLocation` silently returns `'Brampton'` for any unrecognised centre (`legacy-parser.ts:112-116`). Callers cannot tell a real Brampton family from an unknown one.

**Files:**
- Modify: `apps/portal/src/features/setu/registration/legacy-parser.ts:112-116`, `:86`, `:224`
- Test: `apps/portal/src/features/setu/registration/__tests__/legacy-parser.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `LegacyFamilyForMigration` gains `locationDefaulted: boolean`

- [ ] **Step 1: Write the failing test**

```ts
it('reports a real centre as not defaulted', () => {
  const fam = parseLegacyFamily([row({ center: 'Scarborough' })]);
  expect(fam.location).toBe('Scarborough');
  expect(fam.locationDefaulted).toBe(false);
});

it('flags the Brampton fallback when the centre is the string NULL', () => {
  // 574 of 2,543 roster rows carry the literal string "NULL". Those families
  // are indistinguishable from real Brampton families without this flag.
  const fam = parseLegacyFamily([row({ center: 'NULL' })]);
  expect(fam.location).toBe('Brampton');
  expect(fam.locationDefaulted).toBe(true);
});

it('flags the fallback for an empty or missing centre', () => {
  expect(parseLegacyFamily([row({ center: '' })]).locationDefaulted).toBe(true);
  expect(parseLegacyFamily([row({})]).locationDefaulted).toBe(true);
});

it('flags the fallback for an unrecognised centre value', () => {
  // "ALL" appears on 10 rows and is not a real centre.
  expect(parseLegacyFamily([row({ center: 'ALL' })]).locationDefaulted).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- legacy-parser`
Expected: FAIL - `locationDefaulted` is undefined.

- [ ] **Step 3: Implement**

```ts
/** The mapped centre plus whether we had to fall back to the default.
 *  Callers need the distinction: a family that really is in Brampton and one
 *  whose centre we simply do not know both end up as 'Brampton', and only the
 *  second should be asked to confirm it. */
function mapLocationDetailed(value: unknown): { location: LegacyLocation; defaulted: boolean } {
  const s = clean(value);
  if (s && (VALID_LOCATIONS as readonly string[]).includes(s)) {
    return { location: s as LegacyLocation, defaulted: false };
  }
  return { location: 'Brampton', defaulted: true };
}

function mapLocation(value: unknown): LegacyLocation {
  return mapLocationDetailed(value).location;
}
```

Add `locationDefaulted: boolean` to the `LegacyFamilyForMigration` interface at `:86`, and at `:224` replace `location: mapLocation(first.center)` with the detailed call, setting both fields.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- legacy-parser`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/registration/legacy-parser.ts \
        apps/portal/src/features/setu/registration/__tests__/legacy-parser.test.ts
git commit -m "feat(migration): report when the legacy centre was defaulted

mapLocation silently returned Brampton for any unrecognised centre, so a real
Brampton family and one whose centre is unknown were indistinguishable. 574 of
2,543 roster rows carry the literal string NULL.

Adds locationDefaulted alongside the mapped value. mapLocation keeps its
existing signature for callers that do not care."
```

---

### Task 2: The `locationNeedsConfirmation` flag

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/family.ts`
- Modify: `apps/portal/src/features/setu/registration/lazy-migrate.ts:193-200`
- Test: `packages/shared-domain/src/setu/__tests__/schemas.test.ts`, `apps/portal/src/features/setu/registration/__tests__/lazy-migrate.test.ts`

**Interfaces:**
- Consumes: `locationDefaulted` (Task 1)
- Produces: `FamilyDoc.locationNeedsConfirmation?: boolean | null`

- [ ] **Step 1: Write the failing test**

```ts
it('accepts a family doc without the flag (every existing document)', () => {
  // The field is additive. A doc schema validates on READ, so every one of the
  // ~867 existing families must still parse.
  expect(FamilyDocSchema.safeParse(existingFamilyWithoutFlag).success).toBe(true);
});

it('accepts the flag when present', () => {
  expect(FamilyDocSchema.safeParse({ ...base, locationNeedsConfirmation: true }).success).toBe(true);
});

it('still rejects an empty location - the flag does not replace it', () => {
  expect(FamilyDocSchema.safeParse({ ...base, location: '' }).success).toBe(false);
});
```

And for the migration:

```ts
it('sets the flag when the legacy centre was unknown', async () => {
  await lazyMigrateLegacyFamily('9001');   // fixture with center: 'NULL'
  const fam = await readFamilyByLegacyFid('9001');
  expect(fam.location).toBe('Brampton');
  expect(fam.locationNeedsConfirmation).toBe(true);
});

it('does NOT set the flag when the centre was real', async () => {
  await lazyMigrateLegacyFamily('9002');   // fixture with center: 'Scarborough'
  const fam = await readFamilyByLegacyFid('9002');
  expect(fam.locationNeedsConfirmation).toBeFalsy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/shared-domain test -- schemas && pnpm --filter @cmt/portal test -- lazy-migrate`
Expected: FAIL.

- [ ] **Step 3: Add the field**

In `family.ts`, beside `familyAddress`:

```ts
  // True when the legacy centre was unknown and the migration fell back to the
  // default, so the family must confirm their centre at first sign-in. Nullable
  // + optional because doc schemas validate on READ and every pre-existing
  // family lacks it; absence reads as "nothing to confirm".
  //
  // `location` itself deliberately stays a required string: grade-eligible,
  // roster filters, level matching and search all assume it is present, so the
  // unknown-ness rides on this flag rather than on an empty location.
  locationNeedsConfirmation: z.boolean().nullable().optional(),
```

- [ ] **Step 4: Persist it**

In `lazy-migrate.ts`, the `txn.set` on the family doc at `:193-200` adds:

```ts
      ...(legacy.locationDefaulted ? { locationNeedsConfirmation: true } : {}),
```

Spread conditionally rather than writing `false`: `exactOptionalPropertyTypes` is on, and absence already means "nothing to confirm".

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/shared-domain test && pnpm --filter @cmt/portal test -- lazy-migrate`
Expected: PASS.

- [ ] **Step 6: Update the runbook**

Add `families.locationNeedsConfirmation` to §3 of `docs/runbooks/production-cutover-checklist.md` (the spec drafted this text) plus a dated §14 entry. No index - nothing queries it.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/family.ts \
        apps/portal/src/features/setu/registration/lazy-migrate.ts \
        docs/runbooks/production-cutover-checklist.md
git commit -m "feat(migration): flag families whose centre had to be defaulted

location itself stays a required string because grade-eligible, roster
filters, level matching and search all assume it is present - nulling it
would fail read validation everywhere. The unknown-ness rides on an
additive nullable flag instead, so every existing family still parses."
```

---

### Task 3: Skip dormant families in the bulk migration

Measured in the 2026-06-10 snapshot: **299 of 867 families have no usable centre on any row, and none has an active child.** 124 of them still carry child rows, 119 with a mappable grade - **190 children** whose grades are years stale. Migrating them puts those children into Brampton teachers' "Registered - not enrolled" lists, in the wrong level, where they will never appear.

**Files:**
- Modify: `apps/portal/src/features/setu/registration/legacy-parser.ts` (export the predicate)
- Modify: `apps/portal/scripts/migrate-legacy-families.ts`
- Test: `apps/portal/src/features/setu/registration/__tests__/legacy-parser.test.ts`

**Interfaces:**
- Consumes: the legacy roster rows
- Produces: `export function isDormantLegacyFamily(rows: readonly LegacyRosterRow[]): boolean`

- [ ] **Step 1: Write the failing test**

```ts
describe('isDormantLegacyFamily', () => {
  it('is dormant when every row lacks BOTH a centre and a level', () => {
    expect(isDormantLegacyFamily([
      row({ center: 'NULL', level: 'NULL', grade: '99' }),
      row({ center: 'NULL', level: 'NULL', grade: '5' }),
    ])).toBe(true);
  });

  it('is NOT dormant when any row has a real centre', () => {
    expect(isDormantLegacyFamily([
      row({ center: 'NULL', level: 'NULL', grade: '99' }),
      row({ center: 'Brampton', level: 'NULL', grade: '5' }),
    ])).toBe(false);
  });

  it('is NOT dormant when any row has a real level', () => {
    // An active child must never be skipped, whatever the centre says.
    expect(isDormantLegacyFamily([
      row({ center: 'NULL', level: 'Level 2', grade: '2' }),
    ])).toBe(false);
  });

  it('treats the literal string NULL as absent, not as a value', () => {
    // The measuring bug that produced a wrong figure during design: "NULL"
    // is a string in this data, not a null.
    expect(isDormantLegacyFamily([row({ center: 'NULL', level: 'NULL' })])).toBe(true);
  });
});
```

The last test encodes a mistake already made once while analysing this data - the literal string `"NULL"` was counted as a real level, producing a wrong dormancy figure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- legacy-parser`
Expected: FAIL - not exported.

- [ ] **Step 3: Implement the predicate**

```ts
/** Treats '', 'NULL' and 'null' as absent - in this dataset "NULL" is a
 *  literal string, not a null. */
function absent(v: unknown): boolean {
  const s = String(v ?? '').trim();
  return s === '' || s.toUpperCase() === 'NULL';
}

/**
 * A family with no centre on ANY row AND no level on ANY row: last engaged
 * years ago, no active child. Skipped by the bulk migration - not deleted.
 * lazyMigrateLegacyFamily still runs on their first OTP sign-in, kiosk
 * check-in or teacher add, at which point they enter Setu with a real centre
 * and a parent-confirmed grade.
 */
export function isDormantLegacyFamily(rows: readonly LegacyRosterRow[]): boolean {
  return rows.every((r) => absent(r.center)) && rows.every((r) => absent(r.level));
}
```

- [ ] **Step 4: Wire it into the migration**

In `migrate-legacy-families.ts`, skip dormant families. **Count them and write them to `--csv-out`** with a `skipped: dormant` reason, and print the count in the run summary - a silent skip reads as "migrated everything" when it did not.

- [ ] **Step 5: Dry-run against the snapshot**

```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-legacy-families.ts \
  --dry-run --csv-out /tmp/migration-preview.csv
```

Expected: roughly **299 skipped, ~568 migrated**, of 867 total. If the skipped count is far from 299, the predicate is wrong - **stop and investigate before running for real.**

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cmt/portal test -- legacy-parser migrate-legacy-families`
Expected: PASS.

- [ ] **Step 7: Update the runbook**

Amend §6 step 2 of `docs/runbooks/production-cutover-checklist.md` to state that the migration now skips dormant families and where the skipped list lands. Add a dated §14 entry.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/features/setu/registration/legacy-parser.ts \
        apps/portal/scripts/migrate-legacy-families.ts \
        docs/runbooks/production-cutover-checklist.md
git commit -m "feat(migration): skip dormant families in the bulk migration

299 of 867 legacy families have no centre and no active child. 119 of them
still carry children with mappable but years-stale grades - 190 children who
would land in Brampton teachers' 'Registered - not enrolled' lists, in the
wrong level, and never appear.

They are skipped, not deleted: lazy migration still runs on their first
sign-in, kiosk check-in or teacher add, at which point they arrive with a
real centre and a parent-confirmed grade. The skipped set is counted in the
summary and written to --csv-out so it is auditable, never silent."
```

---

### Task 4: Ask for the centre at first sign-in

**Files:**
- Modify: `apps/portal/src/app/family/layout.tsx:48-58`
- Modify: `apps/portal/src/features/setu/members/complete-profile-form.tsx`
- Modify: `apps/portal/src/app/api/setu/family/route.ts` (PATCH)
- Test: layout, form and route tests

**Interfaces:**
- Consumes: `locationNeedsConfirmation` (Task 2)
- Produces: the centre selector on `/complete-profile`

- [ ] **Step 1: Write the failing test**

```tsx
it('diverts a manager whose centre needs confirming', async () => {
  mockCurrentFamily({ isManager: true, family: { ...complete, locationNeedsConfirmation: true } });
  await expect(ProfileCompletionGate()).rejects.toThrow(/NEXT_REDIRECT/);
});

it('does not divert a non-manager', async () => {
  mockCurrentFamily({ isManager: false, family: { ...complete, locationNeedsConfirmation: true } });
  expect(await ProfileCompletionGate()).toBeNull();
});

it('does not divert once the flag is cleared', async () => {
  mockCurrentFamily({ isManager: true, family: { ...complete, locationNeedsConfirmation: false } });
  expect(await ProfileCompletionGate()).toBeNull();
});

it('does not divert a family that never had the flag', async () => {
  // Absence must read as "nothing to confirm" - otherwise all ~867 existing
  // families are diverted on their next sign-in.
  mockCurrentFamily({ isManager: true, family: complete });
  expect(await ProfileCompletionGate()).toBeNull();
});
```

The fourth test guards the worst possible failure here: treating absence as "needs confirming" would gate **every** family at once.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- family/layout`
Expected: FAIL - the gate ignores the flag.

- [ ] **Step 3: Extend the gate**

At `layout.tsx:53-56`, add to the manager-scoped condition:

```ts
  const incomplete =
    incompleteMembers(scope).length > 0 ||
    (data.isManager && !isFamilyAddressComplete(data.family)) ||
    (data.isManager && data.family.locationNeedsConfirmation === true);
```

Compare `=== true` explicitly so `undefined` and `null` both read as "nothing to confirm".

- [ ] **Step 4: Add the centre selector**

In `complete-profile-form.tsx`, render a centre selector **only** when the flag is set, fed by `GET /api/setu/locations` (already family-readable, `can-access-route.ts:199-205`). Follow the existing family-level field pattern the form already uses for `familyAddress` and `ProvinceSelect`.

- [ ] **Step 5: Clear the flag on save**

The family PATCH accepts `location` and, when it changes, clears `locationNeedsConfirmation`. Add a route test asserting both in one call - a save that sets the centre but leaves the flag would re-divert the family forever.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cmt/portal test -- family/layout complete-profile api/setu/family`
Expected: PASS.

- [ ] **Step 7: Deployed-UAT E2E**

Extend `apps/portal/e2e/setu/family/complete-profile.spec.ts`, or add a case:
- seed a family with `locationNeedsConfirmation: true`
- sign in as its manager (password sign-in, never OTP)
- assert the redirect to `/complete-profile` and that the centre selector appears
- pick a centre and save
- assert landing on `/family` **without a bounce-back loop**
- reload and assert no re-divert

Run: `pnpm test:e2e -- complete-profile`

> The bounce-back is the failure mode to watch. `/complete-profile` is top-level precisely so the gate does not re-run at the destination, and leaving it uses a hard navigation. A soft push would re-read a stale `use cache` value and return the family to the same screen with its state preserved.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/app/family/layout.tsx \
        apps/portal/src/features/setu/members/complete-profile-form.tsx \
        apps/portal/src/app/api/setu/family/route.ts \
        apps/portal/e2e/setu/family/complete-profile.spec.ts
git commit -m "feat(family): ask unknown-centre families to confirm their centre

A family whose legacy centre was unknown migrated silently as Brampton and
had no way to correct it - the completion gate checks the member matrix and
the home address, and the home address is not the centre.

The gate now also fires on locationNeedsConfirmation, compared with === true
so absence reads as nothing-to-confirm. Treating absence as needs-confirming
would divert all ~867 existing families at once; a test pins that."
```

---

## Self-Review

**Spec coverage** - `2026-07-24-aug-3-launch-batch-design.md`:
- §1.9b dormant skip, skipped set auditable → Task 3 ✅
- §1.9b grade-first migration self-heals via `birthMonthYear: null` → **no work needed**, already true (`REQUIRED_CHILD` + `lazy-migrate.ts:185`); verified during design ✅
- §1.9c part 1 findability → **no work needed**, the legacy fallback already exists (`find-family-by-contact.ts:62-71`) ✅
- §1.9c part 3 items 1-4 (schema, parser, gate, form) → Tasks 1, 2, 4 ✅
- Caveat W1 measurements → Task 3 Step 5 expects ~299 skipped ✅

**Placeholder scan:** no TBD/TODO. Every code step carries real code or an exact structural instruction against an existing file.

**Type consistency:** `locationDefaulted` (Task 1) is consumed in Task 2. `locationNeedsConfirmation` (Task 2) is read in Task 4 and written in Tasks 2 and 4 with the same `boolean | null | undefined` shape. `isDormantLegacyFamily` (Task 3) takes `LegacyRosterRow[]`, the type the parser already uses.

**Ordering:** Task 1 → Task 2 (needs `locationDefaulted`) → Task 4 (needs the flag). Task 3 depends only on Task 1's exports. Nothing here depends on P1-P5, and nothing in P1-P5 depends on this.
