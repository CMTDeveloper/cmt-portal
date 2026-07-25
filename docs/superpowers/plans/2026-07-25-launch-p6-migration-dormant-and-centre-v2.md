# P6 v2 - Dormant-Family Skip & Unknown-Centre Prompt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep ~190 dormant children with stale grades out of Brampton teachers' launch-Sunday lists, and ask the families whose centre we defaulted to pick their real one.

**Architecture:** The legacy parser - which already loads and filters a family's roster rows - decides dormancy and carries the verdict on its own result. The bulk migration skips dormant families; they still enter Setu lazily on first sign-in. Families that migrate on a defaulted centre carry `locationNeedsConfirmation`, which threads through the **hand-written** family field map into the profile gate, and `/complete-profile` grows a centre selector that starts unselected.

**Tech Stack:** Firebase Admin Firestore + RTDB snapshot, Zod, Next.js 16, Vitest, Playwright.

**Supersedes:** `2026-07-25-launch-p6-migration-dormant-and-centre.md`, reviewed as REQUEST CHANGES (2 critical, 7 major, 7 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p6.md`.

**Spec:** `docs/superpowers/specs/2026-07-24-aug-3-launch-batch-design.md` §1.9a-c. **Both halves are cutover-blocking.**

---

## Global Constraints

- **`FamilyDoc` values reaching the app are NOT produced by `FamilyDocSchema.parse()`.** `getFamilyByFid` builds them with a **hand-written field map** (`get-family-by-fid.ts:27-45`) with no spread. **A field added to the Zod schema but not to that map is `undefined` forever.** This is the single most important fact in this plan; the file's own comment at `:79-82` warns about the same class of omission for `inviteStatus`.
- **`FamilyDocSchema.location` is `z.string().min(1)` and validated on READ** (`schemas/family.ts:55`). Writing `null` or `''` fails validation on every subsequent read of that family. Widening it is the doc-schema-read-validation trap the repo has a standing rule about. Do not.
- **The profile-completeness test is deliberately duplicated** in `ProfileCompletionGate` (`layout.tsx:53-56`) and `DisclaimerGate` (`:76`), so Suspense resolution order cannot decide the destination. A new condition added to one and not the other desynchronises them; the invariant is stated at `:64-66`.
- **Refresh the RTDB snapshot immediately before the prod migration.** `migrate-legacy-families.ts` → `listAllFamilies` → `readRtdb`, which returns **snapshot data and never touches the network** whenever `RTDB_SNAPSHOT_DIR` is set - and CLAUDE.md instructs you to keep it set. The local snapshot is `capturedAt: 2026-06-10`, ~7.7 weeks stale at launch, spanning the summer registration season. Running as-is would silently migrate June-10 data. One capture costs ~$0.0016 (1.6 MB at ~$1/GB); the cost rule targets repeated dev-loop reads, not a deliberate pre-cutover capture.
- All Firestore work targets `chinmaya-setu-uat`. No em dashes. Commit author `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### Measured facts this plan rests on (spec §1.9a, corrected)

- **299 of 867 families (34%)** have no usable centre on any row and migrate as Brampton.
- **0 of the 299 have an active child.** Every one is dormant. An earlier revision claimed 124 did; the measuring script had treated the literal string `"NULL"` as a level.
- **0 families are misassigned** - `mapLocation` only ever defaults on all-NULL families.
- Of the 299: **124 have any child row, 119 have a grade-mappable child, 190 children total.**

### Deliberate deviations

1. **Skipped families are NOT findable by staff, and that is a decision, not an oversight.** The `find-family-by-contact.ts:62-71` legacy fallback covers the family's own sign-in and the kiosk. **`searchFamilies` has no legacy fallback** - it queries only `collection('families')` (`search-families.ts:62-75`), and `/welcome/roster` browses the same collection. So on launch Sunday welcome-team cannot look up any of the 299 by name, phone or legacy FID at the desk. Given all 299 are dormant with no active child, the expected desk traffic is near zero, and the first thing any of them does - sign in, check in at the kiosk, or get added by a teacher - migrates them. **Recorded in the runbook so it is a known limit, not a surprise.**
2. **The residual from spec §1.9b stands:** an *active* family whose legacy centre is genuinely wrong does not self-correct. Welcome-team fixes it once P1's family-edit ships.

---

## Task 1: The dormancy predicate, carried on the parser's own result

**v1's wiring was unimplementable.** It declared `isDormantLegacyFamily(rows: readonly LegacyRosterRow[])` and told the script to call it - but `migrate-legacy-families.ts:91` does `listAllFamilies()`, which returns the **check-in `Family` type** (`{ fid, name, contacts, paymentStatus, students }`). That shape carries **no `center` field at all**, and `level` survives only as `Student.level`, already blanked for adults and normalized lossily at `family-lookup.ts:138-139` (only the exact string `'NULL'` is caught; lowercase `'null'` would survive). Dormancy is not reconstructible from it.

`LegacyRosterRow` is also **not exported** (`legacy-parser.ts:28` - `interface`, no `export`), so the declared signature could not be imported. Note there is a **second, unrelated** `LegacyRosterRow` at `features/check-in/shared/rtdb/classlist.ts:10`; do not conflate them.

**The parser already has what is needed.** `fetchLegacyFamilyForMigration()` loads `/roster` and filters the family's rows (`legacy-parser.ts:237-239`). Decide dormancy there and carry it out.

**Files:** `apps/portal/src/features/setu/registration/legacy-parser.ts` (`:28` export, `:83-93` the `LegacyFamilyForMigration` interface, `:237-239`) + its tests.

- [ ] **Step 1: Write the failing tests**

Use the real export - **`parseLegacyRowsForMigration(rows, legacyFid)`, two required arguments** (`legacy-parser.ts:147-150`). v1's snippets called a nonexistent `parseLegacyFamily([row({...})])` and would not compile. The existing `row()` helper (`__tests__/legacy-parser.test.ts:5-31`) is real and correct - only the call site was wrong.

```ts
it('is dormant when every row has no centre AND no level', () => { /* ... */ });
it('is NOT dormant when any row carries a real centre', () => { /* ... */ });
it('is NOT dormant when any row carries a real level', () => { /* ... */ });
it('treats the literal strings "NULL" and "null" as absent', () => {
  // The snapshot holds 574 rows of literal "NULL". Case matters:
  // family-lookup.ts:139 catches only the uppercase form.
});
it('treats "ALL" as a real centre', () => { /* 10 rows in the snapshot */ });
```

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement and carry it out**

Export `LegacyRosterRow`. Add `dormant: boolean` to `LegacyFamilyForMigration` (the interface spans `:83-93`), set from the same rows the parser already filtered.

- [ ] **Step 3b: Make `mapLocation` report the fallback - without this the WHOLE centre half is inert**

An earlier draft referred to "Task 1's existing `locationDefaulted`". **There is no such field.** Verified: `locationDefaulted` and `mapLocationDetailed` appear nowhere in `apps/` or `packages/`. `mapLocation` (`legacy-parser.ts:111-116`) returns a bare `LegacyLocation` and reports nothing:

```ts
function mapLocation(value: unknown): LegacyLocation {
  const s = clean(value);
  if (s && (VALID_LOCATIONS as readonly string[]).includes(s)) return s as LegacyLocation;
  return 'Brampton';
}
```

`LegacyFamilyForMigration` (`:83-93`) has nine fields and no such flag, and `:224` is the only call site. **So nothing ever writes `locationNeedsConfirmation: true`** - and every downstream edit in Tasks 2, 4, 5 and 6 fires on a value that is permanently absent. This is v1's C1 relocated from the read path to the write path, and Task 2's round-trip test would not catch it because that test seeds the doc directly.

Spec §1.9c Part 3 item 2 asks for it explicitly: *"**Parser** - `mapLocation` reports whether it fell back to the default; `lazy-migrate` persists `locationNeedsConfirmation: true` in that case."*

```ts
export function mapLocationDetailed(value: unknown): { location: LegacyLocation; defaulted: boolean } {
  const s = clean(value);
  if (s && (VALID_LOCATIONS as readonly string[]).includes(s)) {
    return { location: s as LegacyLocation, defaulted: false };
  }
  return { location: 'Brampton', defaulted: true };
}
// mapLocation stays as a thin wrapper so no existing caller changes.
```

Add `locationDefaulted: boolean` to `LegacyFamilyForMigration`, set it at `:224`, and test `defaulted === true` for `center` of `'NULL'`, `''`, missing and `'ALL'`, `false` for `'Brampton'` and `'Scarborough'`.

- [ ] **Step 4: Run and commit**

---

## Task 2: `locationNeedsConfirmation` - schema AND the hand-map

**The schema alone is dead code.** This is the defect that would have shipped `§1.9c` doing nothing, with four green tests.

**Files:**
- `packages/shared-domain/src/setu/schemas/family.ts` (`FamilyDocSchema`)
- **`apps/portal/src/features/setu/members/get-family-by-fid.ts:27-45`** - the hand-written map
- **`apps/portal/src/features/setu/search/get-family-for-welcome.ts:41-50`** - the **second** hand-map, backing `/welcome/family/[fid]`. It already drops `familyEmergencyContact`, `familyAddress` and `disclaimersAccepted`, and would drop this too - killing spec §1.9c's stated bonus that the flag doubles as a welcome-team work queue.
- `get-session-family.ts:22` and `get-current-family.ts:42` need **no change**: they delegate to `getFamilyByFid` and spread the result. An earlier draft called `get-session-family.ts:22` "the same map"; it is `const cached = await getFamilyByFid(fid);`. A full audit of `: FamilyDoc = {` in non-test source finds exactly **two** construction sites, the two named above.
- `apps/portal/src/features/setu/registration/lazy-migrate.ts:193-201` - the family `txn.set`
- `apps/portal/docs/MOBILE_API_CHANGELOG.md`

- [ ] **Step 1: Write the failing test - against `getFamilyByFid`, not a mocked gate**

```ts
it('round-trips locationNeedsConfirmation from the Firestore doc', async () => {
  // NOT a mocked-gate test. v1's tests mocked getCurrentFamily, so all four
  // assertions passed green against a feature that was inert in UAT and prod.
  seedFamilyDoc({ fid: 'CMT-A', locationNeedsConfirmation: true });
  const res = await getFamilyByFid('CMT-A');
  expect(res.family.locationNeedsConfirmation).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Add to the schema**

`locationNeedsConfirmation: z.boolean().nullable().optional()`. **Never add `.min(1)`-style required-ness to a doc schema** - these validate on read.

- [ ] **Step 4: Add to BOTH hand-maps**

```ts
locationNeedsConfirmation: familyData.locationNeedsConfirmation ?? null,
```

in `get-family-by-fid.ts:27-45` **and** `get-family-for-welcome.ts:41-50`. `get-session-family` and `get-current-family` delegate and need no edit.

- [ ] **Step 5: Write it during migration** - `lazy-migrate.ts:193-201` sets it `true` when Task 1 Step 3b's `locationDefaulted` is true, and **omits the key entirely otherwise** (never `false`, per `exactOptionalPropertyTypes`).

Add a `lazyMigrateLegacyFamily` test asserting the written family doc carries `locationNeedsConfirmation: true` for a defaulted-centre legacy family and omits it for a real-centre one. **This is the test that catches a broken writer** - Step 1's `getFamilyByFid` round-trip seeds the doc directly and would pass green against a writer that never runs.
- [ ] **Step 6: `MOBILE_API_CHANGELOG.md` entry.** `FamilyDocSchema` is the `family` object returned by `GET /api/setu/family` (`route.ts:16-21`) and `/api/setu/dashboard`, and the mobile repo hand-mirrors it. Precedent entries at `:52`, `:62`.
- [ ] **Step 7: Run and commit**

---

## Task 3: Skip dormant families in the bulk migration

**Files:** `apps/portal/scripts/migrate-legacy-families.ts`; `apps/portal/src/features/setu/roster/reconcile-migration.ts:24`.

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Skip, and report**

Call `fetchLegacyFamilyForMigration(legacyFid)` (or give `lazyMigrateLegacyFamily` a `skipDormant` option) so the script gets Task 1's `dormant` flag rather than trying to derive it from the check-in shape. Count skips in the run summary and write them to `--csv-out` so the set is auditable.

- [ ] **Step 4: Stop `/welcome/roster` reporting "299 missing" forever**

`reconcile-migration.ts:24` diffs **every** legacy roster fid against Setu:

```ts
const missingFids = legacyFids.filter((fid) => !setuLegacyFids.has(fid));
```

After the skip, `GET /api/welcome/families/migration-status` reports `missing: 299` permanently, and staff cannot distinguish "deliberately skipped as dormant" from "the migration broke" - a red health indicator on a launch-week screen with no explanation.

Exclude dormant fids from `legacyFids` and report them as a separate `skippedDormant` count.

**But not from `listAllFamilies()`** - `reconcile-migration.ts:13` sources its fids from exactly the function Task 1 rejects as unusable, for exactly the same reason: `Family` (`packages/shared-domain/src/check-in/family.ts:31-38`) has no `center`, and `level` survives only as a lossily-normalized `Student.level`. Deriving dormancy there would repeat the mistake one file over.

Two workable mechanisms - pick one and write it down:
- **Persist the verdict.** The skip already knows which fids it skipped; write them to a `migrationSkips` doc (or a `dormantSkipped: true` marker) during Task 3 Step 3, and have `getMigrationStatus` subtract that set. One extra read, no parsing.
- **Read the roster directly** in `reconcile-migration.ts` via the parser rather than `listAllFamilies()`, reusing Task 1's predicate.

The first is cheaper and keeps the roster-parsing in one place. If `MigrationStatusResponse` changes shape, add a mobile changelog entry.

- [ ] **Step 5: Run and commit**

---

## Task 4: `PATCH /api/setu/family` must accept `location`

**v1 asserted it already did. It does not.** `app/api/setu/family/route.ts:28-31`:

```ts
const patchSchema = z.object({
  familyEmergencyContact: FamilyEmergencyContactSchema.nullable().optional(),
  familyAddress: FamilyAddressSchema.optional(),
});
```

Zod strips unknown keys, so `{ location: 'Scarborough' }` parses to `{}`, copies nothing, and **400s**. Sent alongside `familyAddress`, `location` is silently dropped and the family stays Brampton with the flag still set - the "re-divert forever" case.

- [ ] **Step 1: Write the failing tests** - `location` alone succeeds and clears the flag; `location` + `familyAddress` together both land; an unknown centre string is **rejected**.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

Add `location: z.string().min(1).optional()`, copy it to `update.location`, and set `update.locationNeedsConfirmation = false` explicitly (or `FieldValue.delete()`).

**Validate the value against `getLocationOptions()`.** Without it a crafted PATCH writes an arbitrary string into the field that drives level matching and teacher rosters.

- [ ] **Step 4: `MOBILE_API_CHANGELOG.md`** - this is a `/api/setu/**` **request**-shape change.
- [ ] **Step 5: Run and commit**

---

## Task 5: The gate - both copies

**Files:** `apps/portal/src/app/family/layout.tsx:53-56` **and `:76`**.

- [ ] **Step 1: Write the failing tests** - the gate fires for a flagged manager; does not for a member; does not once cleared.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Add the condition to BOTH gates**

`ProfileCompletionGate` at `:53-56` **and** the mirrored profile test inside `DisclaimerGate` at `:76`:

```ts
if (incompleteMembers(data.members).length > 0 || !isFamilyAddressComplete(data.family)) return null;
```

Adding it only at `:53-56` desynchronises them: a manager who needs centre confirmation **and** has a stale disclaimer looks "profile complete" to `DisclaimerGate`, which redirects to `/acknowledgements`, and whichever gate throws first wins the race. The invariant is stated at `:64-66`.

**Cross-plan:** P4 v2 Task 8 inserts `AdultClassGate` after `DisclaimerGate` and extracts a shared `earlierGatesPending(data)`. If P6 lands first without fixing `:76`, P4 copies the incomplete guard and a family needing centre confirmation can be routed to `/adult-class`. **Land this `:76` fix before P4's gate task**, and sequence the two rather than running them in parallel worktrees - both also edit `app/family/__tests__/layout.test.tsx`, which will conflict textually.

- [ ] **Step 4: Run and commit**

---

## Task 6: `/complete-profile` - four edits, not one

**v1 said "render a centre selector" and that alone produces an infinite redirect loop.** `complete-profile-form.tsx:223-231` hard-navigates back to `/family` on load when it thinks there is nothing to do, and that check has no notion of the centre:

```ts
const scoped = membersRequiringCompletion(result.members, result.currentMid, result.isManager);
const addressDone = !result.isManager || isFamilyAddressComplete(result.family);
if (scoped.every((m) => isMemberComplete(m)) && addressDone) {
  navigateTo('/family');
  return;
}
```

The target family for §1.9c is a *returning* family: members complete, address complete, only the centre unknown. Gate → `/complete-profile` → short-circuit → hard nav to `/family` → gate → … permanently. And because it is a **hard** navigation the gate re-runs server-side on fresh data every time, so this is worse than the stale-cache bounce, not better.

- [ ] **Step 1: Write the failing tests - including the negative cases, which are the ones that matter**

Positive: a members-complete, address-complete, centre-unknown manager **stays on the form**; the selector starts unselected; Save sends `location`; the flag clears.

**Negative, and non-optional** - `allReady` is a hard block (`:312-324` shows an error toast and returns without PATCHing or navigating), and **every one of the ~568 bulk-migrated managers passes through this screen at first sign-in**, because `lazy-migrate.ts:132-136,183-189` writes `foodAllergies: null`, `birthMonthYear: null` and `gender: 'PreferNotToSay'`, all of which count as missing:

- an **unflagged** manager with one incomplete member **can still Save**
- a **non-manager** can still Save
- a flagged manager **cannot** Save until they pick

Without these three, a `centreReady` that is unsatisfiable for unflagged families ships green and locks out the entire launch population.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Extend the load short-circuit (`:227`)**

```ts
const centreDone = !result.isManager || result.family.locationNeedsConfirmation !== true;
if (scoped.every((m) => isMemberComplete(m)) && addressDone && centreDone) {
  navigateTo('/family');
  return;
}
```

- [ ] **Step 4: Add `centreReady` to `allReady` (`:288-295`), defined so it cannot deadlock Save**

Today `allReady` is `membersOk && addressReady`, so a manager with everything else complete is "all set", Save proceeds, and the flag is never cleared.

**`centreReady` must be conditional on the flag, not on the value.** Defined as `centre !== ''` it blocks the Save button for **every manager who is not flagged** - which is essentially the entire launch population - because the selector that would satisfy it renders only when the flag is set. That is the repo's recorded "mutually exclusive conditions" trap: a control whose visibility and whose enablement are gated on opposite states is never clickable.

```ts
const centreNeeded = !!data?.isManager && data.family.locationNeedsConfirmation === true;
const centreReady = !centreNeeded || centre !== '';
```

`=== true` matters: the field is `boolean | null | undefined`, and only the literal `true` means "ask". Use the **same** `centreNeeded` expression in Step 3's short-circuit, Step 5's PATCH condition and Step 6's render condition, so the four sites cannot drift.

- [ ] **Step 5: Include `location` in the manager PATCH (`:372-391`)**

Today it sends `{ familyAddress: {...} }` only.

- [ ] **Step 6: The selector starts UNSELECTED**

v1 said "follow the existing family-level field pattern" - but that pattern **seeds from the stored value** (`:238-243`, e.g. `setProvince(addr?.province ?? 'ON')`). Applied here it seeds the selector with `family.location`, which for every flagged family is the **defaulted `'Brampton'`**. The family clicks Save without touching it, the flag clears, and they are silently confirmed as Brampton - precisely what §1.9c exists to prevent, now with a false audit trail saying they chose it.

```tsx
<option value="" disabled>Select your centre…</option>
```

`centreReady` requires a non-empty explicit choice.

- [ ] **Step 7: Run and commit**

---

## Task 7: Verify against deployed UAT, and the runbook

- [ ] **Step 1: Seed** a dormant family, a flagged-centre returning family (members + address complete, centre unknown), and an unflagged control.
- [ ] **Step 2: E2E**
  - the flagged family signs in → lands on `/complete-profile` → **no bounce-back loop** → picks a centre → reaches `/family` → the flag is clear and does not re-fire on reload
  - the control family is unaffected
  - a dormant family signs in and is lazily migrated with a real centre
- [ ] **Step 3: Run against deployed UAT**

```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu centre-confirmation
```

- [ ] **Step 4: Runbook**
  - **§6: refresh the RTDB snapshot immediately before the prod migration**, then diff the family count against 867 so the drift is measured, not assumed
  - the expected `skippedDormant` count so nobody reads it as breakage
  - **the staff-findability limit** from Deviation 1
  - `locationNeedsConfirmation` in §3, and a dated §14 entry
- [ ] **Step 5: Commit**

---

## Self-review

**Spec coverage.** §1.9a D-A/D-B → Task 3 + the snapshot refresh in Global Constraints and Task 7. §1.9b dormant skip → Tasks 1 and 3. §1.9c part 1 findability → Deviation 1, now recorded as a limit rather than claimed as free. §1.9c part 2 centre prompt → Tasks 2, 4, 5, 6.

**Type consistency.** `dormant` (Task 1) is consumed in Task 3. `locationNeedsConfirmation` (Task 2) is read by Task 5's gates and Task 6's form, and cleared by Task 4's PATCH.

**Every review finding addressed:** C1 → Task 2 Step 4 (both hand-maps) + Step 1's unmocked test. C2 → Task 6 Steps 3-6. M1 → Task 1. M2 → Task 4. M3 → Tasks 2 and 4 changelog steps. M4 → Task 5 Step 3. M5 → Task 3 Step 4. M6 → Deviation 1. M7 → Task 5's cross-plan note. M8 → Task 6 Step 6. m1 → Task 1 Step 1 (`parseLegacyRowsForMigration`, two args). m2 → line numbers corrected throughout.

## Review history

Reviewed once after the first draft (`docs/superpowers/reviews/2026-07-25-review-p6v2.md`): 2 critical, 6 major, 8 minor. Both criticals were the same failure shape as v1's, moved one layer:

1. **`locationDefaulted` does not exist and no task created it.** The draft called it "Task 1's *existing*" field. `mapLocation` (`legacy-parser.ts:111-116`) returns a bare `LegacyLocation`, and `LegacyFamilyForMigration` has nine fields with no such flag - so **nothing ever writes `locationNeedsConfirmation: true`**, and every downstream edit fires on a permanently absent value. v1's C1 was the read path; this was the write path. Spec §1.9c Part 3 item 2 asks for the parser change explicitly, and the draft dropped it. Now Task 1 Step 3b, with the `lazyMigrateLegacyFamily` test that would have caught it.
2. **`centreReady` was never defined, and the obvious reading locks out the entire launch population.** `allReady` is a hard block, and every one of the ~568 bulk-migrated managers passes through this screen at first sign-in. `centreReady = centre !== ''` blocks Save for every manager who is not flagged, because the selector that would satisfy it renders only when the flag is set - the repo's recorded mutually-exclusive-conditions trap. Now written out, gated on `centreNeeded`, with three negative tests.

Also corrected: `get-session-family.ts:22` is a **delegation, not a hand-map** (there was nothing to edit there), and the real second construction site is `get-family-for-welcome.ts:41-50`, which backs `/welcome/family/[fid]` and would have dropped the flag - killing the spec's stated welcome-team work-queue bonus. And Task 3 Step 4 repeated the exact unimplementability Task 1 diagnosed, sourcing fids from `listAllFamilies()` again.

**Known risk.** Task 6 changes the screen every returning family passes through on first sign-in, days before a cutover that sends ~867 families through it. Two lines are dangerous in opposite directions: the load short-circuit (too strict and everyone loops, too loose and the centre is never asked) and `centreReady` (too broad and nobody can Save). Write their negative tests first and trust both least.
