# Lazy `publicFid` Minting (Model Y2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint a family's user-facing `publicFid` only at their first enrollment (single funnel `enrollFamily`), not at family creation - so stale families that never enrol never receive an ID.

**Architecture:** `publicFid` becomes lazily minted. `enrollFamily()` gains an idempotent get-or-mint (pre-read + pre-allocate outside the txn, conditional set inside - Firestore forbids nested transactions). The three creation sites (register, legacy-migrate, teacher add-student) stop minting and create the family with `publicFid` omitted. The kiosk gains migrate-on-miss so a legacy family whose first touch is the door is pulled into Setu (record only) and minted when the check-in auto-enrols it. Family-facing surfaces render a "assigned when you enrol" nudge instead of the internal `CMT-` id when `publicFid` is absent.

**Tech Stack:** Next.js 16 App Router, Firestore Admin (`chinmaya-setu-uat`), TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-14-lazy-publicfid-minting-design.md`

## Global Constraints

- `publicFid` is minted in **exactly one place**: `enrollFamily()`. Never at family creation.
- The mint is **idempotent** and **never burns an id when the family already has a `publicFid`**: pre-read the family, pre-allocate ONLY when it lacks one (the allocator opens its own txn - never call it inside `enrollFamily`'s txn), and set inside the txn only if the txn's own read still shows no `publicFid` (a rare TOCTOU loses the pre-allocated id as a harmless gap; ids need not be contiguous).
- **No schema change** - `publicFid` is already `z.string().nullable().optional()` (`packages/shared-domain/src/setu/schemas/family.ts:62`). **No new Firestore index** - all lookups are single-field equality or existing composites.
- **Omit, never `undefined`** - `exactOptionalPropertyTypes` is on. "Stop writing `publicFid`" means removing the key from the `txn.set(...)` object, not setting it to `undefined`.
- **Family-facing surfaces must never show the internal `CMT-` id as the Family ID.** Read `family.publicFid` directly on those surfaces (not `displayFid`, which falls back to `fid`).
- **UAT only** for every DB / test op (`chinmaya-setu-uat`); never prod `715b8`; never `--force` index deploys.
- **No em dash** anywhere (code, comments, docs) - use a plain hyphen.
- **Feature boundaries:** files under `features/setu/*` subdirs may import one another (e.g. `setu/check-in` → `setu/registration`); never import across top-level features.
- Tests ship in the **same commit** as the logic they cover. Commit author is the repo-local `CMT Developer`; never add an agent co-author. Push after each commit (pre-push hook is the gate; never `--no-verify`).
- The allocator band (`FAMILY_START = 5001`) and `allocateMemberPublicIds` are **unchanged** - member ids are still minted at member creation.

---

## File Structure

- `apps/portal/src/features/setu/enrollment/enroll-family.ts` - add lazy mint (Task 1).
- `apps/portal/src/features/setu/registration/register-family.ts` - stop minting (Task 2).
- `apps/portal/src/features/setu/registration/lazy-migrate.ts` - stop minting (Task 2).
- `apps/portal/src/features/setu/teacher/pending-family.ts` - stop minting (Task 2).
- `apps/portal/src/features/setu/check-in/resolve-kiosk-family.ts` - add `resolveKioskFamilyOrMigrate` (Task 3).
- `apps/portal/src/app/api/check-in/setu/lookup/route.ts` + `.../check-in/route.ts` - call the migrate wrapper (Task 3).
- `apps/portal/src/app/family/page.tsx` + `apps/portal/src/app/family/members/page.tsx` - null-`publicFid` nudge (Task 4).
- `docs/runbooks/production-cutover-checklist.md` + `apps/portal/docs/MOBILE_API_CHANGELOG.md` - docs (Task 5).
- Tests colocated in each `__tests__` dir; real-UAT integration in `apps/portal/src/__tests__/e2e/enrollments.e2e.test.ts`; browser E2E under `apps/portal/e2e/` (Tasks 1, 3, 4, 6).

**Task order matters:** Task 1 (add the mint to `enrollFamily`) ships BEFORE Task 2 (remove minting from creation sites) so that at every commit `publicFid` is always minted somewhere - never a window where nothing mints. With Task 1 in and Task 2 not yet, creation sites still mint and `enrollFamily`'s pre-read sees an existing `publicFid`, so it never double-mints.

---

## Task 1: Lazy-mint `publicFid` in `enrollFamily`

**Files:**
- Modify: `apps/portal/src/features/setu/enrollment/enroll-family.ts`
- Test: `apps/portal/src/__tests__/e2e/enrollments.e2e.test.ts` (real UAT Firestore)

**Interfaces:**
- Consumes: `allocateFamilyPublicId(): Promise<string>` from `@/features/setu/ids/public-id-allocator`.
- Produces: `enrollFamily` unchanged signature/return; side effect - on a family with no `publicFid`, sets one during the enrollment txn.

- [ ] **Step 1: Write the failing test** (append inside the existing `hasUatCreds` describe in `enrollments.e2e.test.ts`, reusing its `_test` program/offering fixture and a family created with no `publicFid`).

The suite already creates `_test` families and an open `_test` offering. Add a family document WITHOUT `publicFid` (write it directly with `_test: true`, or reuse the suite's family-creation helper and then delete the `publicFid` field), then:

```ts
it('mints publicFid on the family\'s FIRST enrollment and reuses it on the second', async () => {
  // fid of a _test family created WITHOUT publicFid (child member present so BV is eligible)
  const famRef = db.collection('families').doc(FID_NO_PUBLICFID);
  expect((await famRef.get()).data()?.publicFid).toBeUndefined();

  // First enrollment -> mints
  const first = await enrollFamily({ fid: FID_NO_PUBLICFID, oid: OID, enrolledVia: 'family-initiated', enrolledByMid: null });
  expect(first.created).toBe(true);
  const minted = (await famRef.get()).data()?.publicFid;
  expect(typeof minted).toBe('string');
  expect(Number(minted)).toBeGreaterThanOrEqual(5001);

  // Second enrollment into a different program keeps the SAME publicFid (no re-mint, no burn)
  const second = await enrollFamily({ fid: FID_NO_PUBLICFID, oid: OID_SECOND, enrolledVia: 'family-initiated', enrolledByMid: null });
  expect(second.created).toBe(true);
  expect((await famRef.get()).data()?.publicFid).toBe(minted);
});
```

(Create a second `_test` offering `OID_SECOND` under a second `_test` program in `beforeAll`, mirroring the existing offering setup, so the two enrollments are distinct `eid`s. Ensure `afterAll` cleanup deletes both offerings/programs; families are swept by `cleanupTestData()` via `_test: true`.)

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd apps/portal && pnpm exec vitest run src/__tests__/e2e/enrollments.e2e.test.ts -t "mints publicFid"`
Expected: FAIL - the family has no `publicFid` after enrollment (mint not implemented yet). (Requires `.env.local` pointed at `chinmaya-setu-uat`; the suite skips without UAT creds.)

- [ ] **Step 3: Implement the lazy mint**

Add the allocator import at the top of `enroll-family.ts`:

```ts
import { allocateFamilyPublicId } from '@/features/setu/ids/public-id-allocator';
```

Replace the opening of `enrollFamily` (through the `familyRef` declaration and the start of the txn) so `familyRef` is declared once (outside the txn), a pre-read decides pre-allocation, and the mint is committed inside the txn. The current code declares `const familyRef = db.collection('families').doc(fid);` INSIDE the txn (line ~46) - remove that inner declaration since it moves out.

```ts
export async function enrollFamily(params: EnrollFamilyParams): Promise<EnrollFamilyResult> {
  const { fid, oid, enrolledVia, enrolledByMid } = params;
  const db = portalFirestore();
  const eid = `${fid}-${oid}`;
  const familyRef = db.collection('families').doc(fid);

  // Lazy publicFid mint: the user-facing Family ID is assigned at a family's
  // FIRST enrollment, not at family creation (registration / legacy-migration /
  // teacher-add all leave it unset). The allocator opens its OWN Firestore
  // transaction and Firestore forbids nested transactions, so pre-read the
  // family here and pre-allocate ONLY when it has no publicFid - re-enrollments
  // and multi-program families must never burn an id from the bounded 5001+ band.
  const preFamilySnap = await familyRef.get();
  const preAllocatedPublicFid =
    preFamilySnap.exists && !preFamilySnap.data()?.['publicFid']
      ? await allocateFamilyPublicId()
      : null;

  const result = await db.runTransaction(async (txn) => {
    const offeringRef = db.collection('offerings').doc(oid);
    const enrollmentRef = db
      .collection('families')
      .doc(fid)
      .collection('enrollments')
      .doc(eid);

    const [offeringSnap, enrollmentSnap, familySnap] = await Promise.all([
      txn.get(offeringRef),
      txn.get(enrollmentRef),
      txn.get(familyRef),
    ]);

    if (!familySnap.exists) throw new Error('family-not-found');
    if (!offeringSnap.exists) throw new Error('offering-not-found');

    // Commit the lazy mint inside the SAME txn, but only if the txn's own read
    // still shows no publicFid. If a concurrent enrollment already minted one
    // (rare TOCTOU) keep it and let preAllocatedPublicFid go unused - a harmless
    // gap (ids need not be contiguous), matching the allocator's documented
    // burn-on-skip behavior.
    if (preAllocatedPublicFid && !(familySnap.data() as Record<string, unknown>)['publicFid']) {
      txn.update(familyRef, { publicFid: preAllocatedPublicFid });
    }

    // ... existing body unchanged from `const offeringData = ...` onward ...
```

Leave the rest of the function body (offering parse, program/active gate, enabled/expired gates, existing-enrollment early return, member eligibility, `txn.set(enrollmentRef, ...)`, return) exactly as-is. The mint sits AFTER the family-exists check and BEFORE the existing-enrollment early return, so any enrollment call reconciles a missing `publicFid`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd apps/portal && pnpm exec vitest run src/__tests__/e2e/enrollments.e2e.test.ts -t "mints publicFid"`
Expected: PASS - `publicFid` minted on the first enrollment, unchanged on the second.

- [ ] **Step 5: Typecheck + commit**

Run: `cd /Users/dineshmatta/projects/chinmaya-mission-portal && pnpm typecheck` (expect exit 0; capture the real exit standalone, never behind a pipe/tail).

```bash
git add apps/portal/src/features/setu/enrollment/enroll-family.ts apps/portal/src/__tests__/e2e/enrollments.e2e.test.ts
git commit -m "feat(setu): lazy-mint publicFid at first enrollment (enrollFamily)"
```

---

## Task 2: Stop minting `publicFid` at the three creation sites

**Files:**
- Modify: `apps/portal/src/features/setu/registration/register-family.ts`
- Modify: `apps/portal/src/features/setu/registration/lazy-migrate.ts`
- Modify: `apps/portal/src/features/setu/teacher/pending-family.ts`
- Test: the existing integration/unit tests for these three (extend them to assert `publicFid` is absent after create).

**Interfaces:**
- Consumes: nothing new.
- Produces: `registerFamily`, `lazyMigrateLegacyFamily`, `upsertPendingFamilyChild` create the family doc with `publicFid` omitted. `allocateMemberPublicIds` calls are UNCHANGED (member ids still minted).

- [ ] **Step 1: Write/extend the failing tests**

For each of the three creation paths there is existing coverage (registration integration test, lazy-migrate test, teacher add-student test - locate via `grep -rl "registerFamily\|lazyMigrateLegacyFamily\|upsertPendingFamilyChild" apps/portal/src --include=*.test.ts`). Add/extend an assertion that the created family document has **no** `publicFid`:

```ts
// after the create call resolves:
const fam = (await db.collection('families').doc(result.fid).get()).data();
expect(fam?.publicFid).toBeUndefined();
```

For the real-UAT registration/lazy-migrate integration tests, use the same `_test` fixture + cleanup already in those suites. If a path lacks a direct create test, add a minimal one in that feature's `__tests__` dir.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd apps/portal && pnpm exec vitest run <the three test files>`
Expected: FAIL - `publicFid` is currently present after create.

- [ ] **Step 3: Remove the allocation + write in all three files**

**`register-family.ts`** - delete the `publicFid` allocation and its field:
- Remove the line `const publicFid = await allocateFamilyPublicId();` (currently ~line 84).
- Keep `const publicMids = await allocateMemberPublicIds(1 + input.additionalMembers.length);` and `managerPublicMid`.
- In the `txn.set(familyRef, { ... })`, remove the `publicFid,` line (currently ~line 154).
- Update the comment block above the allocation so it only describes `publicMids` (drop the "user-facing 4-digit publicFid" clause).
- Remove `allocateFamilyPublicId` from the import if now unused (keep `allocateMemberPublicIds`).

**`lazy-migrate.ts`** - same treatment:
- Remove `const publicFid = await allocateFamilyPublicId();` (~line 79). Keep `allocateMemberPublicIds(memberCount)`.
- In the family `txn.set(db.collection('families').doc(fid), { ... })`, remove the `publicFid,` line (~line 195).
- Update the comment to describe only `publicMids`.
- Drop `allocateFamilyPublicId` from the import if unused.

**`pending-family.ts`** - same treatment:
- Remove `const newFamilyPublicFid = await allocateFamilyPublicId();` (~line 65). Keep `const publicMids = await allocateMemberPublicIds(2);`.
- In the new-family `txn.set(db.collection('families').doc(newFid), { ... })`, remove the `publicFid: newFamilyPublicFid,` line (~line 108).
- Update the comment block (lines ~58-64) to describe only the two `publicMids`.
- Drop `allocateFamilyPublicId` from the import if unused.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd apps/portal && pnpm exec vitest run <the three test files>`
Expected: PASS - each family is created with no `publicFid`.

- [ ] **Step 5: Typecheck + commit**

Run: `cd /Users/dineshmatta/projects/chinmaya-mission-portal && pnpm typecheck` (exit 0, standalone).

```bash
git add apps/portal/src/features/setu/registration/register-family.ts apps/portal/src/features/setu/registration/lazy-migrate.ts apps/portal/src/features/setu/teacher/pending-family.ts <the three test files>
git commit -m "feat(setu): stop minting publicFid at family creation (defer to enrollment)"
```

---

## Task 3: Kiosk migrate-on-miss

**Files:**
- Modify: `apps/portal/src/features/setu/check-in/resolve-kiosk-family.ts` (add `resolveKioskFamilyOrMigrate`)
- Modify: `apps/portal/src/app/api/check-in/setu/lookup/route.ts` and `apps/portal/src/app/api/check-in/setu/check-in/route.ts` (call the wrapper)
- Test: `apps/portal/src/features/setu/check-in/__tests__/resolve-kiosk-family.test.ts` (create if absent)

**Interfaces:**
- Consumes: `resolveKioskFamily(id)` (existing, unchanged), `lazyMigrateLegacyFamily(legacyFid)` from `@/features/setu/registration/lazy-migrate`.
- Produces: `resolveKioskFamilyOrMigrate(id: string): Promise<ResolvedKioskFamily | null>`.

- [ ] **Step 1: Write the failing test** (`resolve-kiosk-family.test.ts`, mocking both `resolveKioskFamily`'s Firestore and `lazyMigrateLegacyFamily`). Use `vi.hoisted` + `vi.mock` on `@/features/setu/registration/lazy-migrate` and on the firestore handle, mirroring `auto-enroll-bala-vihar.test.ts`.

```ts
it('returns a Setu hit without migrating', async () => {
  // resolveKioskFamily resolves a family -> lazyMigrate NOT called
});
it('on a Setu miss, migrates the legacy family then re-resolves', async () => {
  // first resolve -> null, lazyMigrateLegacyFamily -> ok, second resolve -> family
  // assert lazyMigrateLegacyFamily called with the trimmed id
});
it('returns null when the number is in neither Setu nor the legacy roster', async () => {
  // resolve -> null, lazyMigrateLegacyFamily throws 'Legacy family not found' -> null
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd apps/portal && pnpm exec vitest run src/features/setu/check-in/__tests__/resolve-kiosk-family.test.ts`
Expected: FAIL - `resolveKioskFamilyOrMigrate` is not exported yet.

- [ ] **Step 3: Implement the wrapper** in `resolve-kiosk-family.ts` (append below `resolveKioskFamily`; add the import at the top):

```ts
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';
```

```ts
/**
 * Resolve a kiosk family, lazily migrating a LEGACY family that is not in Setu
 * yet (their first touch is the door). On a Setu miss we treat the entered
 * number as a legacy check-in id and run the idempotent lazyMigrateLegacyFamily;
 * on success we re-resolve. A number in neither Setu nor the legacy roster makes
 * lazyMigrateLegacyFamily throw, and we return null (genuinely unknown), matching
 * the previous not-found behavior. The migrate creates the family record WITHOUT
 * a publicFid - that is minted when the check-in auto-enrolls the family.
 */
export async function resolveKioskFamilyOrMigrate(id: string): Promise<ResolvedKioskFamily | null> {
  const found = await resolveKioskFamily(id);
  if (found) return found;

  const trimmed = id.trim();
  if (!trimmed) return null;
  try {
    await lazyMigrateLegacyFamily(trimmed);
  } catch {
    return null;
  }
  return resolveKioskFamily(trimmed);
}
```

Then point both routes at the wrapper:
- `lookup/route.ts`: change the import to `resolveKioskFamilyOrMigrate` and call it at line ~31 (`const resolved = await resolveKioskFamilyOrMigrate(id);`).
- `check-in/route.ts`: same - import `resolveKioskFamilyOrMigrate` and call it at line ~41 (`const family = await resolveKioskFamilyOrMigrate(parsed.data.id);`).

Both routes' downstream code is unchanged (the wrapper returns the same `ResolvedKioskFamily | null` shape).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd apps/portal && pnpm exec vitest run src/features/setu/check-in/__tests__/resolve-kiosk-family.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd /Users/dineshmatta/projects/chinmaya-mission-portal && pnpm typecheck` (exit 0, standalone).

```bash
git add apps/portal/src/features/setu/check-in/resolve-kiosk-family.ts apps/portal/src/app/api/check-in/setu/lookup/route.ts apps/portal/src/app/api/check-in/setu/check-in/route.ts apps/portal/src/features/setu/check-in/__tests__/resolve-kiosk-family.test.ts
git commit -m "feat(setu): kiosk migrate-on-miss so a door-first legacy family enters Setu"
```

---

## Task 4: Family-facing null-`publicFid` nudge

**Files:**
- Modify: `apps/portal/src/app/family/page.tsx`
- Modify: `apps/portal/src/app/family/members/page.tsx`
- Test: a render test for the dashboard ID card (colocated under `apps/portal/src/app/family/__tests__/`), or extend an existing dashboard render test.

**Interfaces:**
- Consumes: `data.family.publicFid` (`string | null`, already serialized by `get-family-by-fid.ts:28`).
- Produces: family surfaces show a numeric `publicFid` when present, else an "assigned when you enrol" nudge - never the `CMT-` id.

- [ ] **Step 1: Write the failing test**

Add a test that renders the dashboard ID region with a family whose `publicFid` is null and asserts it shows the pending copy (e.g. `Assigned when you enrol`) and does NOT render the `CMT-` id; and with a `publicFid` set, asserts the number renders. If the dashboard page is hard to render in isolation (server component with cache helpers), instead unit-test a small extracted helper/component `FamilyIdPending` and assert the page selects it when `publicFid` is null. Prefer extracting a tiny presentational component so it is unit-testable without the full server page.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd apps/portal && pnpm exec vitest run <the dashboard id-card test>`
Expected: FAIL - the pending state does not exist yet.

- [ ] **Step 3: Implement**

In `family/page.tsx`:
- Change line ~291 from `familyFid = displayFid(data.family);` to:
  ```ts
  familyFid = data.family.publicFid ?? null; // the real user-facing id, or null until first enrollment
  ```
  (`familyFid` is already typed `string | null`; `showLegacy` at line ~315 still works - a not-yet-enrolled legacy family shows its legacy id transition with the new id pending.)
- Add a small pending component near `FamilyIdValue`:
  ```tsx
  function FamilyIdPending() {
    return (
      <div>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Your Family ID</p>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>Assigned when you enrol</p>
      </div>
    );
  }
  ```
  (Mirror `FamilyIdValue`'s label styling; read it in the same file to match.)
- At both render sites (mobile ~line 384 and desktop ~line 453), change `{familyFid ? <FamilyIdValue fid={familyFid} mobile /> : null}` / `{familyFid ? <FamilyIdValue fid={familyFid} /> : null}` to render `<FamilyIdPending />` in the null branch instead of `null`.

In `family/members/page.tsx`:
- Change line ~44 from `familyFid = displayFid(data.family);` to `familyFid = data.family.publicFid ?? mockFamily.fid;` is WRONG (would show CMT-). Instead compute a display string that is the number or a short dash:
  ```ts
  familyFid = data.family.publicFid ?? '-';
  ```
  so the `FID {familyFid}` captions (lines ~72, ~120) read `FID -` for a not-yet-enrolled family rather than the internal id. (Members is a secondary surface; a dash is sufficient.)

Use the spelling that matches the existing page copy (British/loc): check the surrounding copy for "enrol" vs "enroll" and match it. (The codebase uses "Enroll"/"enroll" widely - match that, i.e. "Assigned when you enroll".)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd apps/portal && pnpm exec vitest run <the dashboard id-card test>`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd /Users/dineshmatta/projects/chinmaya-mission-portal && pnpm typecheck` (exit 0, standalone).

```bash
git add apps/portal/src/app/family/page.tsx apps/portal/src/app/family/members/page.tsx <the test>
git commit -m "feat(setu): family dashboard shows 'ID assigned at enrollment' when publicFid is unset"
```

---

## Task 5: Runbook + Mobile API changelog

**Files:**
- Modify: `docs/runbooks/production-cutover-checklist.md`
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`

**Interfaces:** docs only; no code.

- [ ] **Step 1: Update the cutover checklist**

In `docs/runbooks/production-cutover-checklist.md`:
- In the §6 Data Migration Sequence, mark the eager **Step 2 (migrate-legacy-families --allow-prod)** and **Step 5 (migrate:public-ids / renumber:public-ids --allow-prod)** as **removed from the prod path** under the lazy model - prod families migrate lazily on first sign-in / kiosk touch and are minted at first enrollment. Keep the commands documented as historical/UAT-only, but the prod checklist no longer runs them.
- Add a dated §14 entry (2026-07-14) summarizing: lazy `publicFid` minting adopted (Model Y2); prod cutover no longer bulk-migrates or renumbers; `publicFid` is minted at first enrollment via `enrollFamily`; UAT remains eagerly migrated (left as-is); kiosk gains migrate-on-miss.

- [ ] **Step 2: Add the mobile changelog entry**

Append a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md` (use the head commit SHA of this slice once known; if writing before the final commit, note "SHA: <fill at merge>") stating: `publicFid` in `/api/setu/dashboard` (and any `/api/setu/*` response returning it) is now **null until the family's first enrollment**, then becomes the minted number. Mobile must treat a null `publicFid` as "not yet enrolled" and show the enroll nudge rather than a placeholder id. No request-shape change; additive/behavioral only.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/production-cutover-checklist.md apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "docs(setu): lazy-publicFid cutover + mobile changelog (null-until-enrollment)"
```

---

## Task 6: Deployed-UAT browser E2E (sign-in → pending → enrol → id appears)

**Files:**
- Create: `apps/portal/e2e/setu/lazy-publicfid.spec.ts`

**Interfaces:** consumes the existing `e2e/auth-helpers.ts` (cookie-injection auth; never form password typing) and the `_test` seeding conventions.

- [ ] **Step 1: Write the E2E** against deployed UAT (`PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app`). Flow:
  1. Via API/seed, create a fresh `_test` family with a child and NO `publicFid` (post-Task-2 `registerFamily` produces exactly this; or write the doc directly), and a signed-in session for its manager (auth helper).
  2. Load `/family` - assert the ID card shows the pending copy ("Assigned when you enroll"), NOT a `CMT-` id.
  3. Enrol into the open `_test` BV offering (drive the enroll UI, or POST `/api/setu/enrollments` then reload).
  4. Reload `/family` - assert the ID card now shows a numeric id `>= 5001`.
  5. Cleanup: delete the seeded `_test` family/enrollment/offering (afterAll), matching the mutation-spec cleanup convention.

Keep the mint's authoritative check in the Task 1 real-UAT integration test; this spec verifies the user-visible dashboard transition through the real render/cache path.

- [ ] **Step 2: Run it against deployed UAT**

Run: `cd apps/portal && PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm exec playwright test e2e/setu/lazy-publicfid.spec.ts`
Expected: PASS (after the slice is deployed - see Verification).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/setu/lazy-publicfid.spec.ts
git commit -m "test(setu): deployed-UAT E2E for lazy publicFid mint on enrollment"
```

---

## Final verification (before declaring done)

- Full gate green standalone: `cd /Users/dineshmatta/projects/chinmaya-mission-portal && pnpm typecheck && pnpm lint && pnpm test && pnpm build` (capture the real exit; never pipe through `tail`).
- Push (pre-push hook runs the gate). After deploy propagates, run the Task 6 Playwright spec against `https://cmt-setu.vercel.app` and re-run the Task 1 UAT integration test with `.env.local` → `chinmaya-setu-uat`.
- Mock-free walkthrough on deployed UAT: a fresh family shows the pending ID card, gains a numeric id on enrollment, and keeps the same id on a second-program enrollment (N=2). Kiosk: a legacy id not previously in Setu resolves + checks in + gains an id. State verification status plainly in the summary (tests-pass vs UAT-verified).
- Confirm no new Firestore index was needed (all lookups single-field or existing composite); confirm `firestore.indexes.json` is untouched.

## Out of scope / intentionally unchanged

- **`build-session-claims.ts` is NOT modified.** `lazyMigrateLegacyFamily(legacyFid)` is still called on first legacy sign-in (build-session-claims ~line 172); Task 2 only removes the `publicFid` mint from inside `lazyMigrateLegacyFamily`, not the call. So a legacy family's record + `legacyFid` link + `contactKeys` are still created at sign-in (now with `publicFid` unset), and `/register` remains the net-new-only path. This is what keeps cross-identity dedup safe: legacy families are keyed by `legacyFid` at sign-in, so the kiosk (which resolves by `legacyFid`) finds them and never creates a second family. If a task reviewer sees a not-yet-enrolled family on `/family`, that is the expected Model-Y2 state (record present, `publicFid` null, Part C nudge), not a bug.
- `allocateMemberPublicIds` / `publicMid` timing is unchanged.
- No queue, no schema change, no new Firestore index, no `firestore.indexes.json` edit.

## Self-review notes

- Spec coverage: Part A → Tasks 1-2; Part B → Task 3; Part C → Task 4; cutover + mobile → Task 5; testing → Tasks 1/3/4/6. All spec sections mapped.
- Type consistency: `resolveKioskFamilyOrMigrate` returns the same `ResolvedKioskFamily | null` as `resolveKioskFamily`; `familyFid` stays `string | null` on the dashboard; `enrollFamily` signature/return unchanged.
- Ordering guarantees every commit leaves `publicFid` minted somewhere (Task 1 before Task 2).
- No placeholders; the two "locate the existing test file" steps are concrete grep instructions, not TBDs.
